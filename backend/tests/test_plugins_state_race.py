"""Cursa del cicle load→modify→save de plugins.json.

`_plugins_lock` fa atòmics cada load i cada save PER SEPARAT, però dues
mutacions concurrents (p.ex. desar settings de dos plugins alhora des de dos
tabs) llegien el mateix snapshot i l'última escriptura esclafava l'altra
(last-writer-wins). `_plugins_mutation_lock` serialitza el cicle sencer als
handlers: la segona mutació espera i el seu load ja veu l'escriptura de la
primera. Mateix patró que test_daily_note_race.py / test_comments_race.py.
"""
import asyncio
import copy
import threading

import pytest

import backend.api.vault_routes as vr


class _FakeStore:
    """Simula plugins.json: load amb rendez-vous + save que hi escriu.

    Rendez-vous DETERMINISTA (no un sleep amb timing): sense candau, els dos
    load concurrents es troben a la barrera i tots dos tornen el MATEIX
    snapshot → l'últim save esclafa l'altre. Amb el candau, el segon load no
    s'executa fins després del primer save: la barrera venç (timeout) i el
    segon cicle ja parteix de l'estat actualitzat.
    """

    def __init__(self):
        self.state = {"disabled": [], "settings": {}, "granted": {}}
        self.saves = 0
        self._barrier = threading.Barrier(2)

    def load(self):
        # Snapshot ABANS de la barrera: si es prengués després, el GIL pot
        # serialitzar la lectura darrere del save de l'altre fil i el test
        # passaria fins i tot sense candau (fals negatiu).
        snap = copy.deepcopy(self.state)
        try:
            self._barrier.wait(timeout=0.5)
        except threading.BrokenBarrierError:
            pass
        return snap

    def save(self, payload):
        self.state = copy.deepcopy(payload)
        self.saves += 1
        return copy.deepcopy(payload)


@pytest.fixture()
def store(monkeypatch):
    st = _FakeStore()
    monkeypatch.setattr(vr, "_load_plugins_state", st.load)
    monkeypatch.setattr(vr, "_save_plugins_state", st.save)
    # Candau nou per test: un asyncio.Lock queda lligat a l'event loop del
    # primer acquire, i cada asyncio.run() n'obre un de diferent.
    monkeypatch.setattr(vr, "_plugins_mutation_lock", asyncio.Lock())
    return st


def test_concurrent_settings_both_survive(store):
    """Dos PUT /plugins/{id}/settings simultanis: cap dels dos s'ha de perdre."""

    async def scenario():
        return await asyncio.gather(
            vr.set_plugin_settings(
                "plugin-a", vr.PluginSettingsRequest(settings={"color": "blau"})
            ),
            vr.set_plugin_settings(
                "plugin-b", vr.PluginSettingsRequest(settings={"color": "verd"})
            ),
        )

    asyncio.run(scenario())
    assert store.state["settings"] == {
        "plugin-a": {"color": "blau"},
        "plugin-b": {"color": "verd"},
    }, "un dels dos settings s'ha perdut (cursa load→modify→save)"


def test_concurrent_registry_url_and_settings(store):
    """PUT /plugins/registry-url concurrent amb settings: totes dues mutacions
    toquen claus DIFERENTS de l'estat i han de sobreviure totes dues."""

    async def scenario():
        return await asyncio.gather(
            vr.set_registry_url(vr.RegistryUrlRequest(url="https://plugins.example")),
            vr.set_plugin_settings(
                "plugin-a", vr.PluginSettingsRequest(settings={"n": 1})
            ),
        )

    asyncio.run(scenario())
    assert store.state.get("registry_url") == "https://plugins.example"
    assert store.state["settings"] == {"plugin-a": {"n": 1}}


def test_sequential_settings_merge(store):
    """Sanejament: dues escriptures seqüencials es fusionen (sense cursa)."""

    async def scenario():
        await vr.set_plugin_settings(
            "plugin-a", vr.PluginSettingsRequest(settings={"color": "blau"})
        )
        await vr.set_plugin_settings(
            "plugin-a", vr.PluginSettingsRequest(settings={"mida": 3})
        )

    asyncio.run(scenario())
    assert store.state["settings"]["plugin-a"] == {"color": "blau", "mida": 3}

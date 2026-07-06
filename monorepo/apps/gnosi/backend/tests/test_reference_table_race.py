"""Cursa entre la designació de taula de referències (Settings) i
l'auto-migració one-shot de `get_reference_table_id`.

Tots dos escriuen `zotero_db_config.json` amb un cicle load→modify→save.
Sense `cfg_lock` (i sense re-comprovar l'estat fresc dins del candau),
una auto-migració en curs podia esclafar la designació que l'usuari acabava
de desar a Settings. Mateix patró de test determinista amb Barrier que
test_daily_note_race.py.
"""
import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

import backend.api.vault_routes as vr
import backend.services.reference_table_config as rtc

_CITABLE_REGISTRY = {
    "tables": [
        {
            "id": "t-citable",
            "name": "Recursos",
            "properties": [{"id": "p1", "name": "Citation Key", "type": "text"}],
        }
    ],
    "databases": [],
    "views": [],
}


class _FakeCfgStore:
    """Simula el JSON de config amb rendez-vous determinista al load."""

    def __init__(self, cfg: dict, parties: int = 2):
        self.cfg = cfg
        self._barrier = threading.Barrier(parties)

    def load(self, path, default=None):
        # Snapshot ABANS de la barrera: si es prengués després, el GIL pot
        # serialitzar la lectura darrere del save de l'altre fil i el test
        # passaria fins i tot sense candau (fals negatiu).
        snap = copy.deepcopy(self.cfg)
        try:
            self._barrier.wait(timeout=0.5)
        except threading.BrokenBarrierError:
            pass
        return snap

    def save(self, path, data):
        self.cfg = copy.deepcopy(data)


@pytest.fixture()
def store(monkeypatch):
    st = _FakeCfgStore({})
    monkeypatch.setattr(rtc, "load_json", st.load)
    monkeypatch.setattr(rtc, "save_json", st.save)
    monkeypatch.setattr(vr, "load_registry", lambda: copy.deepcopy(_CITABLE_REGISTRY))
    return st


def test_settings_choice_survives_concurrent_automigration(store):
    """La designació de l'usuari a Settings guanya sempre, encara que
    l'auto-migració corri en paral·lel."""
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_set = ex.submit(vr._set_reference_table_id, "user-choice")
        f_get = ex.submit(vr.get_reference_table_id)
        f_set.result(timeout=5)
        f_get.result(timeout=5)

    assert store.cfg["target_table"] == "user-choice", (
        "l'auto-migració ha esclafat la designació de Settings (cursa)"
    )
    assert store.cfg["references_configured"] is True


def test_automigration_adopts_when_unconfigured(store):
    """Sanejament: sense designació ni pas per Settings, adopta la taula citable."""
    assert vr.get_reference_table_id() == "t-citable"
    assert store.cfg["target_table"] == "t-citable"


def test_automigration_respects_deliberate_deactivation(store):
    """Si l'usuari ha DESACTIVAT referències a Settings (target buit però
    configured=True), l'auto-migració no s'hi fica."""
    store.cfg = {"target_table": "", "references_configured": True}
    assert vr.get_reference_table_id() is None
    assert store.cfg["target_table"] == ""

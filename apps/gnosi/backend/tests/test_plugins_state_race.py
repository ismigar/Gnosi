"""Race in the plugins.json load→modify→save cycle.

`_plugins_lock` makes each load and each save atomic SEPARATELY, but two
concurrent mutations (e.g. saving settings for two plugins at once from two
tabs) read the same snapshot and the last write clobbered the other
(last-writer-wins). `_plugins_mutation_lock` serializes the whole cycle in the
handlers: the second mutation waits and its load already sees the first one's
write. Same pattern as test_daily_note_race.py / test_comments_race.py.
"""
import asyncio
import copy
import threading

import pytest

import backend.api.vault_routes as vr


class _FakeStore:
    """Simulates plugins.json: load with a rendezvous + save that writes to it.

    DETERMINISTIC rendezvous (not a timing-based sleep): without a lock, the two
    concurrent loads meet at the barrier and both return the SAME
    snapshot → the last save clobbers the other. With the lock, the second load
    doesn't run until after the first save: the barrier times out and the
    second cycle already starts from the updated state.
    
    """

    def __init__(self):
        self.state = {"disabled": [], "settings": {}, "granted": {}}
        self.saves = 0
        self._barrier = threading.Barrier(2)

    def load(self):
        # Snapshot BEFORE the barrier: if taken after, the GIL could
        # serialize the read behind the save of the other thread and the test
        # would pass even without a lock (false negative).
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
    # New lock for the test: an asyncio.Lock stays bound to the event loop of the
    # first acquire, and each asyncio.run() opens a different one.
    monkeypatch.setattr(vr, "_plugins_mutation_lock", asyncio.Lock())
    return st


def test_concurrent_settings_both_survive(store):
    """Two simultaneous PUT /plugins/{id}/settings: neither of the two must be lost."""

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
    """PUT /plugins/registry-url concurrent with settings: both mutations
    touch DIFFERENT keys of the state and both must survive."""

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
    """Sanity check: two sequential writes merge fine (no race)."""

    async def scenario():
        await vr.set_plugin_settings(
            "plugin-a", vr.PluginSettingsRequest(settings={"color": "blau"})
        )
        await vr.set_plugin_settings(
            "plugin-a", vr.PluginSettingsRequest(settings={"mida": 3})
        )

    asyncio.run(scenario())
    assert store.state["settings"]["plugin-a"] == {"color": "blau", "mida": 3}

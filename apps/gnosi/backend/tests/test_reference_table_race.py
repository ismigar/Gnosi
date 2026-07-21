"""Race between the references-table designation (Settings) and
the one-shot auto-migration of `get_reference_table_id`.

Both write `zotero_db_config.json` through a load→modify→save cycle.
Without `cfg_lock` (and without re-checking the fresh state inside the lock),
an in-progress auto-migration could clobber the designation the user had just
saved in Settings. Same deterministic Barrier-based test pattern as
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
    """Simulates the config JSON with a deterministic rendez-vous on load."""

    def __init__(self, cfg: dict, parties: int = 2):
        self.cfg = cfg
        self._barrier = threading.Barrier(parties)

    def load(self, path, default=None):
        # Snapshot BEFORE the barrier: if taken after, the GIL could
        # serialize the read behind the save of the other thread and the test
        # would pass even without a lock (false negative).
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
    """The user's designation in Settings always wins, even if
    the auto-migration runs in parallel."""
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
    """Sanity check: with no designation and no pass through Settings, it adopts the citable table."""
    assert vr.get_reference_table_id() == "t-citable"
    assert store.cfg["target_table"] == "t-citable"


def test_automigration_respects_deliberate_deactivation(store):
    """If the user has DISABLED references in Settings (empty target but
    configured=True), the auto-migration stays out of it."""
    store.cfg = {"target_table": "", "references_configured": True}
    assert vr.get_reference_table_id() is None
    assert store.cfg["target_table"] == ""

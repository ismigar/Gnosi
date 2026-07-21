"""Races in the meeting_reminders.json load→modify→save cycle.

The state has FOUR concurrent mutators: `scan_and_notify` (scheduler thread,
every minute), `dismiss` and `update_settings` (API), and the `get_active` prune.
Without `_state_lock`, two mutations would read the same snapshot and the last
write would clobber the other; moreover, the scan saved a snapshot taken BEFORE
the AI agenda generation (seconds), resurrecting reminders that
the user had dismissed in the meantime. Same deterministic test pattern with
Barrier as test_daily_note_race.py.
"""
import copy
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest

import backend.services.meeting_reminders as mr


def _reminder(rid: str, start_iso: str) -> dict:
    return {
        "id": rid,
        "key": f"{rid}|{start_iso}",
        "title": rid,
        "start": start_iso,
        "dismissed": False,
    }


class _FakeStore:
    """Simulates meeting_reminders.json. With `parties=2`, the load performs a
    deterministic rendez-vous: without a lock, the two concurrent cycles would read
    the same snapshot; with the lock, the second load waits for the first save and the
    barrier resolves via timeout."""

    def __init__(self, state: dict, parties: int = 0):
        self.state = state
        self._barrier = threading.Barrier(parties) if parties else None

    def load(self):
        # Snapshot BEFORE the barrier: if it were taken after, the GIL could
        # serialize the read behind the save of the other thread and the test
        # would pass even without a lock (false negative).
        snap = copy.deepcopy(self.state)
        if self._barrier is not None:
            try:
                self._barrier.wait(timeout=0.5)
            except threading.BrokenBarrierError:
                pass
        return snap

    def save(self, state):
        self.state = copy.deepcopy(state)


def _install(monkeypatch, store: _FakeStore):
    monkeypatch.setattr(mr, "_load_state", store.load)
    monkeypatch.setattr(mr, "_save_state", store.save)


def test_concurrent_dismiss_both_survive(monkeypatch):
    """Two simultaneous dismisses (two clicks on the banner): none must be lost."""
    start = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    store = _FakeStore(
        {
            "settings": dict(mr.DEFAULT_SETTINGS),
            "notified": {},
            "active": [_reminder("a", start), _reminder("b", start)],
        },
        parties=2,
    )
    _install(monkeypatch, store)

    with ThreadPoolExecutor(max_workers=2) as ex:
        r1 = ex.submit(mr.dismiss, "a")
        r2 = ex.submit(mr.dismiss, "b")
        assert r1.result(timeout=5) and r2.result(timeout=5)

    ids = {a["id"] for a in store.state["active"]}
    assert ids == set(), f"un dismiss s'ha perdut (cursa): queden {ids}"


def test_scan_does_not_resurrect_dismissed(monkeypatch):
    """A dismiss made DURING the scan (while the AI generates the agenda) must
    survive: the final merge reloads fresh state instead of saving the
    snapshot from before the long-running work."""
    now = datetime.now(timezone.utc)
    x_start = (now + timedelta(minutes=3)).isoformat()
    y_start = (now + timedelta(minutes=5)).isoformat()
    old = _reminder("x", x_start)
    store = _FakeStore(
        {
            "settings": {"enabled": True, "lead_minutes": 10},
            "notified": {old["key"]: now.isoformat()},
            "active": [old],
        }
    )
    _install(monkeypatch, store)

    y_event = {"id": "y", "title": "reunió nova", "start": y_start, "end": y_start}
    import backend.api.calendar_routes as cr

    monkeypatch.setattr(
        cr, "collect_all_events", lambda *a, **k: [y_event]
    )
    monkeypatch.setattr(mr, "_dispatch_notification", lambda reminder: None)

    scan_in_agenda = threading.Event()
    dismiss_done = threading.Event()

    def slow_agenda(ev):
        # Simulates the AI call: signals that the scan is in the long phase and
        # waits for the user's dismiss to have completed.
        scan_in_agenda.set()
        assert dismiss_done.wait(timeout=5), "el dismiss no ha arribat"
        return ""

    monkeypatch.setattr(mr, "_generate_agenda", slow_agenda)

    with ThreadPoolExecutor(max_workers=1) as ex:
        scan = ex.submit(mr.scan_and_notify)
        assert scan_in_agenda.wait(timeout=5), "l'escaneig no ha arrencat"
        assert mr.dismiss("x") is True
        dismiss_done.set()
        result = scan.result(timeout=5)

    assert result["new"] == 1
    ids = {a["id"] for a in store.state["active"]}
    assert ids == {"y"}, f"el recordatori descartat ha ressuscitat: {ids}"
    # The dedup key of the new reminder stays registered.
    assert any(k.startswith("y|") for k in store.state["notified"])


def test_concurrent_settings_and_dismiss(monkeypatch):
    """simultaneous update_settings and dismiss: both mutations survive."""
    start = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    store = _FakeStore(
        {
            "settings": dict(mr.DEFAULT_SETTINGS),
            "notified": {},
            "active": [_reminder("a", start)],
        },
        parties=2,
    )
    _install(monkeypatch, store)

    with ThreadPoolExecutor(max_workers=2) as ex:
        r1 = ex.submit(mr.update_settings, {"lead_minutes": 30})
        r2 = ex.submit(mr.dismiss, "a")
        r1.result(timeout=5)
        assert r2.result(timeout=5)

    assert store.state["settings"]["lead_minutes"] == 30
    assert store.state["active"] == [], "el dismiss s'ha perdut (cursa)"

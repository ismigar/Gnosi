"""Curses del cicle load→modify→save de meeting_reminders.json.

L'estat té QUATRE mutadors concurrents: `scan_and_notify` (fil de l'scheduler,
cada minut), `dismiss` i `update_settings` (API) i el prune de `get_active`.
Sense `_state_lock`, dues mutacions llegien el mateix snapshot i l'última
escriptura esclafava l'altra; a més, l'escaneig desava un snapshot pres ABANS
de la generació d'agenda amb IA (segons), ressuscitant recordatoris que
l'usuari havia descartat mentrestant. Mateix patró de test determinista amb
Barrier que test_daily_note_race.py.
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
    """Simula meeting_reminders.json. Amb `parties=2`, el load fa un
    rendez-vous determinista: sense candau els dos cicles concurrents llegien
    el mateix snapshot; amb candau, el segon load espera el primer save i la
    barrera venç per timeout."""

    def __init__(self, state: dict, parties: int = 0):
        self.state = state
        self._barrier = threading.Barrier(parties) if parties else None

    def load(self):
        # Snapshot ABANS de la barrera: si es prengués després, el GIL pot
        # serialitzar la lectura darrere del save de l'altre fil i el test
        # passaria fins i tot sense candau (fals negatiu).
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
    """Dos dismiss simultanis (dos clics al banner): cap s'ha de perdre."""
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
    """Un dismiss fet DURANT l'escaneig (mentre la IA genera l'agenda) ha de
    sobreviure: la fusió final recarrega l'estat fresc en lloc de desar el
    snapshot d'abans de la feina llarga."""
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
        # Simula la crida d'IA: senyala que l'escaneig és a la fase llarga i
        # espera que el dismiss de l'usuari s'hagi completat.
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
    # La clau de dedup del nou recordatori queda registrada.
    assert any(k.startswith("y|") for k in store.state["notified"])


def test_concurrent_settings_and_dismiss(monkeypatch):
    """update_settings i dismiss simultanis: totes dues mutacions sobreviuen."""
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

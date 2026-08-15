"""Race in the daily note's get-or-create (POST /api/vault/daily).

Two SIMULTANEOUS requests for the same date both passed the "find"
(no results) and TWO notes were created (reproduced against the real backend with
two concurrent POSTs). `_daily_note_lock` serializes the get-or-create: the
second request waits and its "find" already sees the note created by the first.
"""
import asyncio
import threading

import pytest

import backend.api.vault_routes as vr


class _FakeStore:
    """Simulates the store: find with rendez-vous + create that writes to it."""

    def __init__(self):
        self.created = []
        self.existing_id = None
        # DETERMINISTIC rendez-vous (not a timing-based sleep): without the lock, the
        # two concurrent "find"s meet at the barrier and both return None
        # → two creations. With the lock, the second find doesn't run until
        # after the create: the barrier trips (timeout) for the first and the
        # segon ja veu la nota creada.
        self._barrier = threading.Barrier(2)

    def find(self, date_str):
        try:
            self._barrier.wait(timeout=0.5)
        except threading.BrokenBarrierError:
            pass
        return self.existing_id

    async def create(self, req, background_tasks):
        self.created.append(req.title)
        self.existing_id = f"created-{len(self.created)}"
        return {"id": self.existing_id, "title": req.title}


@pytest.fixture()
def store(monkeypatch):
    st = _FakeStore()
    # Folder mode (no source table): the DB-backed path is exercised all the same because
    # it shares the same lock; here we exercise the generic path.
    monkeypatch.setattr(vr, "_daily_source_config", lambda: (None, None))
    monkeypatch.setattr(vr, "_find_daily_note_id", st.find)
    monkeypatch.setattr(vr, "_load_daily_template_content", lambda: "")
    monkeypatch.setattr(vr, "create_page", st.create)

    async def fake_get_page(pid):
        return {"id": pid}

    monkeypatch.setattr(vr, "get_page", fake_get_page)
    return st


def test_concurrent_get_or_create_creates_once(store):
    async def scenario():
        req = vr.DailyNoteRequest(date="2026-07-06")
        return await asyncio.gather(
            vr.get_or_create_daily_note(req, None),
            vr.get_or_create_daily_note(req, None),
        )

    r1, r2 = asyncio.run(scenario())
    assert len(store.created) == 1, "dues creacions per la mateixa data (cursa)"
    # Both answers point to the SAME note.
    assert r1["id"] == r2["id"] == "created-1"


def test_sequential_get_or_create_is_idempotent(store):
    async def scenario():
        req = vr.DailyNoteRequest(date="2026-07-06")
        first = await vr.get_or_create_daily_note(req, None)
        second = await vr.get_or_create_daily_note(req, None)
        return first, second

    r1, r2 = asyncio.run(scenario())
    assert len(store.created) == 1
    assert r1["id"] == r2["id"]

"""Cursa del get-or-create de la nota diària (POST /api/vault/daily).

Dues peticions SIMULTÀNIES per la mateixa data passaven totes dues el "find"
(cap resultat) i es creaven DUES notes (reproduït contra el backend real amb
dos POST concurrents). `_daily_note_lock` serialitza el get-or-create: la
segona petició espera i el seu "find" ja veu la nota creada per la primera.
"""
import asyncio
import threading

import pytest

import backend.api.vault_routes as vr


class _FakeStore:
    """Simula el magatzem: find amb rendez-vous + create que hi escriu."""

    def __init__(self):
        self.created = []
        self.existing_id = None
        # Rendez-vous DETERMINISTA (no un sleep amb timing): sense candau, els
        # dos "find" concurrents es troben a la barrera i tots dos tornen None
        # → dues creacions. Amb el candau, el segon find no s'executa fins
        # després del create: la barrera venç (timeout) per al primer i el
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
    # Mode carpeta (sense taula font): el camí BD-backed es prova igual perquè
    # comparteix el mateix candau; aquí exercim el camí genèric.
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
    # Totes dues respostes apunten a la MATEIXA nota.
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

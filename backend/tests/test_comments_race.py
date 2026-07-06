"""Cursa del cicle load→modify→save dels comentaris de pàgina i inline.

El `threading.Lock` de `_load_comments`/`_save_comments` fa atòmics cada load i
cada save PER SEPARAT, però el cicle sencer dels handlers no ho era: dos POST
simultanis carregaven el mateix snapshot, tots dos hi afegien el seu comentari
i el segon save trepitjava el primer (reproduït contra el backend real: dels
dos comentaris concurrents només en sobrevivia un). Els candaus
`_comments_mutation_lock` i `_inline_comments_mutation_lock` serialitzen el
cicle sencer.

El rendez-vous és DETERMINISTA (threading.Barrier, no un sleep): sense candau
els dos load concurrents es troben a la barrera i tots dos parteixen del mateix
snapshot; amb el candau, el segon load no s'executa fins després del primer
save (la barrera venç per timeout) i ja veu el comentari de l'altre.
"""
import asyncio
import copy
import threading
from pathlib import Path

import pytest

import backend.api.vault_routes as vr


class _FakeCommentsStore:
    def __init__(self):
        self.data = {}
        self._barrier = threading.Barrier(2)

    def load(self):
        try:
            self._barrier.wait(timeout=0.5)
        except threading.BrokenBarrierError:
            pass
        return copy.deepcopy(self.data)  # còpia, com llegir del disc

    def save(self, data):
        self.data = copy.deepcopy(data)


@pytest.fixture()
def store(monkeypatch):
    st = _FakeCommentsStore()
    monkeypatch.setattr(vr, "_load_comments", st.load)
    monkeypatch.setattr(vr, "_save_comments", st.save)
    return st


def test_concurrent_page_comment_adds_keep_both(store):
    async def scenario():
        return await asyncio.gather(
            vr.add_page_comment("p1", vr.CommentCreateRequest(body="A", author="QA")),
            vr.add_page_comment("p1", vr.CommentCreateRequest(body="B", author="QA")),
        )

    r1, r2 = asyncio.run(scenario())
    bodies = sorted(c["body"] for c in store.data.get("p1", []))
    assert bodies == ["A", "B"], "un dels dos comentaris concurrents s'ha perdut"
    assert r1["id"] != r2["id"]


def test_concurrent_inline_comment_adds_keep_both(monkeypatch):
    barrier = threading.Barrier(2)
    state = {"list": []}

    def load(pid):
        try:
            barrier.wait(timeout=0.5)
        except threading.BrokenBarrierError:
            pass
        return copy.deepcopy(state["list"])

    def save(path, data, **kw):
        state["list"] = copy.deepcopy(data)

    monkeypatch.setattr(vr, "_load_inline_comments", load)
    monkeypatch.setattr(vr, "safe_write_json", save)
    monkeypatch.setattr(vr, "_inline_comments_path", lambda pid: Path("/tmp/qa-inline.json"))

    async def scenario():
        return await asyncio.gather(
            vr.create_inline_comment("p1", vr.InlineCommentRequest(comment="A")),
            vr.create_inline_comment("p1", vr.InlineCommentRequest(comment="B")),
        )

    asyncio.run(scenario())
    comments = sorted(c["comment"] for c in state["list"])
    assert comments == ["A", "B"], "un dels dos inline-comments concurrents s'ha perdut"

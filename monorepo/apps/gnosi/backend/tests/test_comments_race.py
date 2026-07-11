"""Race in the load→modify→save cycle of page and inline comments.

The `threading.Lock` in `_load_comments`/`_save_comments` makes each load and
each save atomic SEPARATELY, but the whole handler cycle wasn't: two simultaneous
POSTs loaded the same snapshot, both added their comment to it,
and the second save clobbered the first (reproduced against the real backend: of the
two concurrent comments only one survived). The
`_comments_mutation_lock` and `_inline_comments_mutation_lock` locks serialize the
whole cycle.

The rendez-vous is DETERMINISTIC (threading.Barrier, not a sleep): without the lock
the two concurrent loads meet at the barrier and both start from the same
snapshot; with the lock, the second load doesn't run until after the first
save (the barrier trips on timeout) and it already sees the other's comment.
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
        return copy.deepcopy(self.data)  # copy, like reading from disk

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

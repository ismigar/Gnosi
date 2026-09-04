"""Race in the load→modify→save cycle of the central registry (vault_db_registry.json).

The ~20 `vault_routes` handlers (create/edit tables, schemas, views,
options…) and the 2 `vault_views_routes` handlers (upsert/delete per-page views)
load and save the ENTIRE file. Without a lock serializing the whole
cycle, two concurrent mutations would read the SAME snapshot and the last
write would clobber the other (last-writer-wins) — the same systemic pattern as
PRs #728/#729/#743 (daily note, comments, plugins), but over the largest
store and with no protection at all.

`registry_mutation()` (a shared `threading.RLock`) makes the whole cycle
atomic. The key subtlety here is that the lock is a THREAD lock (RLock), not `asyncio.Lock`:
the real mutators run both on the event loop (async handlers, synchronous body with no
`await`) and in worker threads (`asyncio.to_thread`: e.g. the Notion clone's
`write_table`/`write_view`, or the internal sanitization in `load_registry`). That's why
the tests exercise real THREADS.

Template: `test_plugins_state_race.py` from #743. The snapshot is captured BEFORE
the barrier: capturing it after would let the GIL serialize the read
behind the other thread's `save`, and the test would pass even without a lock
(false negative). Verified in the negative: commenting out the `with registry_mutation()`
in `create_view` makes `test_concurrent_create_view_both_survive` fail.
"""
import asyncio
import copy
import threading
import time

import pytest

import backend.api.vault_routes as vr
from backend.domains.vault.tables.contracts import DatabaseUpsertRequest


class _FakeRegistryStore:
    """Simulates vault_db_registry.json: `load` with a rendezvous + `save` that writes to it.

    DETERMINISTIC rendezvous (not a timing-based sleep): without a lock, the two
    concurrent `load` calls meet at the barrier and both return the SAME
    snapshot → the last `save` clobbers the other. With the lock, the second `load`
    doesn't run until after the first `save`: the barrier expires (timeout) and the
    second cycle already starts from the updated state.
    
    """

    def __init__(self):
        self.state = {
            "databases": [],
            "tables": [],
            "views": [],
            "option_catalogs": {},
            "pages": {},
        }
        self.saves = 0
        self._barrier = threading.Barrier(2)

    def load(self):
        # Snapshot BEFORE the barrier (see the module docstring).
        snap = copy.deepcopy(self.state)
        try:
            self._barrier.wait(timeout=0.5)
        except threading.BrokenBarrierError:
            pass
        return snap

    def save(self, data):
        self.state = copy.deepcopy(data)
        self.saves += 1


@pytest.fixture()
def store(monkeypatch):
    st = _FakeRegistryStore()
    # The handlers reference `load_registry`/`save_registry` as globals of the
    # module: monkeypatching them replaces them at call time. The fake
    # versions do NOT touch the lock, so the ONLY lock in play is the one acquired by
    # `registry_mutation()` wrapping the handler body.
    monkeypatch.setattr(vr, "load_registry", st.load)
    monkeypatch.setattr(vr, "save_registry", st.save)
    # New RLock per test so it doesn't carry state across tests.
    monkeypatch.setattr(vr, "_registry_mutation_lock", threading.RLock())
    return st


def _run_async_in_thread(coro_factory):
    """Runs a coroutine in its own THREAD (a new event loop). Returns (thread, box).

    A real thread is needed —not `asyncio.gather`— because the lock is a `threading.RLock`:
    in a single event loop, two handlers with no `await` already run serially and would not
    exercise the cross-thread race that the lock has to cover.
    
    """
    box: dict = {}

    def runner():
        try:
            box["value"] = asyncio.run(coro_factory())
        except BaseException as exc:  # noqa: BLE001 — el propaguem al test
            box["error"] = exc

    t = threading.Thread(target=runner)
    t.start()
    return t, box


def test_concurrent_create_view_both_survive(store):
    """Two simultaneous POST /views (different threads): neither view is lost.

    Without `registry_mutation()` wrapping `create_view`, this test fails:
    both `load` calls return `views: []`, each thread adds its own and the last
    `save` clobbers the other → only one survives.
    
    """
    view_a = {"id": "view-a", "table_id": "t1", "name": "A"}
    view_b = {"id": "view-b", "table_id": "t1", "name": "B"}

    t1, r1 = _run_async_in_thread(lambda: vr.create_view(dict(view_a)))
    t2, r2 = _run_async_in_thread(lambda: vr.create_view(dict(view_b)))
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert "error" not in r1, r1.get("error")
    assert "error" not in r2, r2.get("error")
    ids = {v["id"] for v in store.state["views"]}
    assert ids == {"view-a", "view-b"}, f"s'ha perdut una vista (cursa RMW): {ids}"
    # Two cycles → two saves; the lock serializes, it merges none.
    assert store.saves == 2


def test_concurrent_create_database_both_survive(store):
    """Two simultaneous POST /databases: no database is lost."""
    db_a = {"id": "db-a", "name": "A"}
    db_b = {"id": "db-b", "name": "B"}

    t1, r1 = _run_async_in_thread(
        lambda: vr.create_database(DatabaseUpsertRequest.model_validate(db_a))
    )
    t2, r2 = _run_async_in_thread(
        lambda: vr.create_database(DatabaseUpsertRequest.model_validate(db_b))
    )
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert "error" not in r1, r1.get("error")
    assert "error" not in r2, r2.get("error")
    ids = {d["id"] for d in store.state["databases"]}
    assert ids == {"db-a", "db-b"}, f"s'ha perdut una base de dades: {ids}"


def test_cross_module_lock_is_shared():
    """The `vault_views_routes` lock is the SAME as `vault_routes`'s.

    A per-page view upsert (vault_views) and a `create_table` (vault_routes)
    write the same file; if each module had its own lock,
    they would still clobber each other. Here we check it at the primitive level: while one
    thread holds `vr.registry_mutation()`, another that enters `vv._registry_mutation()`
    must BLOCK until the first releases it.

    (Does not use the `store` fixture: exercises the real global RLock, without touching disk.)
    
    """
    from backend.api import vault_views_routes as vv

    events: list[str] = []
    a_holding = threading.Event()
    let_a_go = threading.Event()

    def hold_from_vault_routes():
        with vr.registry_mutation():
            events.append("vr-acquire")
            a_holding.set()
            let_a_go.wait(timeout=1.0)
            events.append("vr-release")

    def try_from_vault_views():
        a_holding.wait(timeout=1.0)
        with vv._registry_mutation():
            events.append("vv-acquire")

    ta = threading.Thread(target=hold_from_vault_routes)
    tb = threading.Thread(target=try_from_vault_views)
    ta.start()
    tb.start()

    assert a_holding.wait(timeout=1.0)
    # Give B time to try (and get blocked): it must NOT have acquired.
    time.sleep(0.1)
    assert "vv-acquire" not in events, "els mòduls NO comparteixen candau (cursa entre mòduls)"

    let_a_go.set()
    ta.join(timeout=2.0)
    tb.join(timeout=2.0)

    assert events == ["vr-acquire", "vr-release", "vv-acquire"], events


def test_sequential_mutations_accumulate(store):
    """Sanity check: two SEQUENTIAL mutations (no race) accumulate correctly."""

    async def scenario():
        await vr.create_view({"id": "v1", "table_id": "t1", "name": "1"})
        await vr.create_view({"id": "v2", "table_id": "t1", "name": "2"})

    # Without concurrency, we disable the barrier so it doesn't block the single thread.
    store._barrier = threading.Barrier(1)
    asyncio.run(scenario())

    ids = {v["id"] for v in store.state["views"]}
    assert ids == {"v1", "v2"}

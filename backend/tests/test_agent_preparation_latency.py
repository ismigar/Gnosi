"""Pre-model checks stay scoped while unrelated chat history and team membership grow."""
from contextlib import contextmanager
import time

import pytest

from backend.services import agent_execution_store as store, agent_execution_trace as trace
from backend.services.agent_execution_models import AgentRun, ExecutionScope


def test_model_reservation_is_bounded_by_the_run_tree(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "resolve_data_dir", lambda **kwargs: tmp_path)
    scope = ExecutionScope(user_id="person", workspace_id="work", vault_path=str(tmp_path), role="owner")
    for identifier, parent in (("root", ""), ("child", "root"), ("phase", "child")):
        row = AgentRun(run_id=identifier, parent_run_id=parent, agent_id="bot", skill_id="test",
                       operation="plan", origin="chat", status="running", created_at=0, updated_at=0)
        store.create(row, scope, {"max_calls": 1, "mode": "job" if identifier == "root" else "phase"}, {})
    with store.connect() as db:
        db.execute("""WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<8000)
            INSERT INTO agent_runs SELECT 'unrelated-' || n, 'person','work',?, '{}','{}','{}',0 FROM ids""", (str(tmp_path),))
        db.execute("ANALYZE")
    connect = store.connect

    @contextmanager
    def bounded_connection():
        with connect() as db:
            db.set_progress_handler(lambda: 1, 5000)
            yield db

    monkeypatch.setattr(store, "connect", bounded_connection)
    store.reserve_model_call(scope, "phase", 2)
    with pytest.raises(RuntimeError, match="agent_job_call_budget_exceeded"):
        store.reserve_model_call(scope, "child", 2)
    assert store.read(scope, "phase").model_calls == 1 and store.read(scope, "child").model_calls == 0


def test_idle_retention_needs_no_write_lock_but_collects_orphans(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "resolve_data_dir", lambda **kwargs: tmp_path)
    scope = ExecutionScope(user_id="person", workspace_id="work", vault_path=str(tmp_path), role="owner")
    row = AgentRun(run_id="keep", agent_id="bot", skill_id="test", operation="answer", origin="chat",
                   status="completed", created_at=0, updated_at=0, closed_at=time.time())
    store.create(row, scope, {}, {"keep": True})
    trace.append(scope, "keep", "result", {"text": "shared " * 300})
    trace.expire(scope)
    with store.connect() as db:
        db.execute("BEGIN IMMEDIATE")
        # A clean, up-to-date store can be inspected while a writer owns the reservation.
        trace.expire(scope)
    with store.connect() as db:
        db.execute("INSERT INTO agent_run_snapshots VALUES ('orphan','{}')")
        db.execute("INSERT INTO agent_trace_blobs VALUES ('orphan','{}')")
        db.execute("INSERT INTO agent_trace_links VALUES ('absent','orphan')")
    trace.maintain()
    with store.connect() as db:
        assert not db.execute("SELECT 1 FROM agent_run_snapshots WHERE digest='orphan'").fetchone()
        assert not db.execute("SELECT 1 FROM agent_trace_blobs WHERE digest='orphan'").fetchone()
        assert not db.execute("SELECT 1 FROM agent_trace_links WHERE root='absent'").fetchone()
    assert trace.events(scope, "keep")["events"][0]["value"]["text"] == "shared " * 300

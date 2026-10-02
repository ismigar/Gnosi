"""Private, scope-bound execution records shared by every application entrypoint."""
from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
import hashlib
from contextlib import contextmanager
from collections.abc import Iterator
from typing import Any, cast

from backend.config.data_dir import resolve_data_dir
from backend.services.agent_execution_models import AgentRun, ExecutionScope


_WORKER_INSTANCE = uuid.uuid4().hex


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    path = resolve_data_dir(create=True) / "agent_runs.sqlite"
    connection = sqlite3.connect(path, timeout=30)
    try:
        os.chmod(path, 0o600)
        connection.row_factory = sqlite3.Row
        connection.execute("""CREATE TABLE IF NOT EXISTS agent_runs (
            run_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
            vault_path TEXT NOT NULL, payload TEXT NOT NULL, request TEXT NOT NULL,
            snapshot TEXT NOT NULL, cancelled INTEGER NOT NULL DEFAULT 0)""")
        connection.execute("CREATE TABLE IF NOT EXISTS agent_run_snapshots (digest TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        connection.execute("CREATE INDEX IF NOT EXISTS agent_runs_scope ON agent_runs(user_id,workspace_id,vault_path)")
        yield connection
        connection.commit()
    finally:
        connection.close()


def create(run: AgentRun, scope: ExecutionScope, request: dict[str, Any], snapshot: dict[str, Any]) -> None:
    resumable = (request.get("mode") is None and not request.get("resume_requires_parent")) or (request.get("mode") == "job" and request.get("operation") in {"reader.analysis", "notebook.analysis", "podcast"})
    if request.get("operation") == "podcast" and not snapshot.get("behavior_resources"):
        resumable = False
    run = run.model_copy(update={"resumable": resumable})
    with connect() as db:
        if request.get("mode") == "job" and request.get("operation") == "podcast":
            db.execute("BEGIN IMMEDIATE")
            if _podcast_busy(db, scope.vault_path):
                raise ValueError("podcast_generation_already_running")
        if request.get("mode") == "job" and request.get("operation") == "meeting.minutes":
            db.execute("BEGIN IMMEDIATE")
            active = db.execute("""SELECT request FROM agent_runs WHERE user_id=? AND workspace_id=? AND vault_path=?
                AND json_extract(request,'$.operation')='meeting.minutes'
                AND json_extract(payload,'$.status') IN ('queued','running','resuming')""",
                (scope.user_id, scope.workspace_id, scope.vault_path)).fetchall()
            if any(_worker_alive(json.loads(row[0])) for row in active):
                raise ValueError("meeting_already_running")
        encoded_snapshot = json.dumps(snapshot, ensure_ascii=False, sort_keys=True)
        digest = hashlib.sha256(encoded_snapshot.encode()).hexdigest()
        db.execute("INSERT OR IGNORE INTO agent_run_snapshots VALUES (?,?)", (digest, encoded_snapshot))
        db.execute("INSERT INTO agent_runs VALUES (?,?,?,?,?,?,?,0)", (
            run.run_id, scope.user_id, scope.workspace_id, scope.vault_path,
            run.model_dump_json(), json.dumps({**request, "_worker_pid": os.getpid(), "_worker_instance": _WORKER_INSTANCE}), json.dumps({"_snapshot_ref": digest}),
        ))


def _podcast_busy(db: sqlite3.Connection, vault_path: str, exclude_run_id: str = "") -> bool:
    """Reserve the shared output without exposing another owner's job."""
    active = db.execute("""SELECT request FROM agent_runs WHERE vault_path=? AND run_id!=?
        AND json_extract(request,'$.mode')='job' AND json_extract(request,'$.operation')='podcast'
        AND json_extract(payload,'$.status') IN ('queued','running','resuming')""",
        (vault_path, exclude_run_id)).fetchall()
    return any(_worker_alive(json.loads(row[0])) for row in active)


def _saved_snapshot(db: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    payload = json.loads(str(row["snapshot"]))
    if "_snapshot_ref" in payload:
        saved = db.execute("SELECT payload FROM agent_run_snapshots WHERE digest=?", (payload["_snapshot_ref"],)).fetchone()
        if saved is None:
            raise RuntimeError("agent_snapshot_missing")
        return cast(dict[str, Any], json.loads(saved[0]))
    return cast(dict[str, Any], payload)


def _row(db: sqlite3.Connection, scope: ExecutionScope, run_id: str) -> sqlite3.Row:
    row = db.execute(
        "SELECT * FROM agent_runs WHERE run_id=? AND user_id=? AND workspace_id=? AND vault_path=?",
        (run_id, scope.user_id, scope.workspace_id, scope.vault_path),
    ).fetchone()
    if row is None:
        raise LookupError("agent_run_not_found")
    run = AgentRun.model_validate_json(str(row["payload"]))
    request = json.loads(str(row["request"]))
    if (run.status in {"running", "resuming"} or (run.status == "queued" and request.get("operation") in {"meeting.minutes", "podcast"})) and not _worker_alive(request):
        run = run.model_copy(update={"status": "interrupted", "error": "worker_stopped", "updated_at": time.time()})
        db.execute("UPDATE agent_runs SET payload=? WHERE run_id=?", (run.model_dump_json(), run_id))
        row = db.execute("SELECT * FROM agent_runs WHERE run_id=?", (run_id,)).fetchone()
    return cast(sqlite3.Row, row)


def _worker_alive(request: dict[str, Any]) -> bool:
    worker = request.get("_worker_pid")
    if not isinstance(worker, int):
        return True
    if worker == os.getpid():
        return bool(request.get("_worker_instance", _WORKER_INSTANCE) == _WORKER_INSTANCE)
    try:
        os.kill(worker, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    return True


def _claim_worker(db: sqlite3.Connection, run_id: str) -> None:
    db.execute("UPDATE agent_runs SET request=json_set(request,'$._worker_pid',?,'$._worker_instance',?) WHERE run_id=?",
               (os.getpid(), _WORKER_INSTANCE, run_id))


def read(scope: ExecutionScope, run_id: str) -> AgentRun:
    with connect() as db:
        return AgentRun.model_validate_json(str(_row(db, scope, run_id)["payload"]))


def update(scope: ExecutionScope, run_id: str, **changes: Any) -> AgentRun:
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        old = AgentRun.model_validate_json(str(_row(db, scope, run_id)["payload"]))
        if changes.get("status") in {"completed", "failed", "cancelled"} and old.closed_at is None:
            changes["closed_at"] = time.time()
        elif changes.get("status") in {"running", "resuming"}:
            changes["closed_at"] = None
            changes["trace_state"] = "available"
        run = AgentRun.model_validate({**old.model_dump(), **changes, "updated_at": time.time()})
        db.execute("UPDATE agent_runs SET payload=? WHERE run_id=?", (run.model_dump_json(), run_id))
        if changes.get("status") in {"running", "resuming"}:
            _claim_worker(db, run_id)
    if changes.get("status") in {"running", "resuming"} and old.trace_state in {"expired", "deleted"}:
        from backend.services.agent_execution_trace import append
        append(scope, run_id, "trace.restarted", {"previous_trace_state": old.trace_state})
    return run


def increment_usage(scope: ExecutionScope, run_id: str, provider: str, model: str,
                    input_tokens: int, output_tokens: int) -> None:
    """Keep concurrent provider completions from overwriting token counters."""
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        old = AgentRun.model_validate_json(str(_row(db, scope, run_id)["payload"]))
        updated = old.model_copy(update={"provider": provider, "model": model,
            "input_tokens": old.input_tokens + input_tokens,
            "output_tokens": old.output_tokens + output_tokens,
            "usage_available": True, "updated_at": time.time()})
        db.execute("UPDATE agent_runs SET payload=? WHERE run_id=?", (updated.model_dump_json(), run_id))


def list_runs(scope: ExecutionScope, limit: int = 50) -> list[AgentRun]:
    from backend.services.agent_execution_trace import expire
    expire(scope)
    with connect() as db:
        rows = db.execute(
            "SELECT run_id FROM agent_runs WHERE user_id=? AND workspace_id=? AND vault_path=? ORDER BY rowid DESC LIMIT ?",
            (scope.user_id, scope.workspace_id, scope.vault_path, max(1, min(200, limit))),
        ).fetchall()
        return [AgentRun.model_validate_json(str(_row(db, scope, row[0])["payload"])) for row in rows]


def cancel(scope: ExecutionScope, run_id: str) -> AgentRun:
    with connect() as db:
        row = _row(db, scope, run_id)
        run = AgentRun.model_validate_json(str(row["payload"]))
        if run.status not in {"completed", "failed", "cancelled"}:
            db.execute("UPDATE agent_runs SET cancelled=1 WHERE run_id=?", (run_id,))
    return read(scope, run_id)


def cancelled(scope: ExecutionScope, run_id: str) -> bool:
    with connect() as db:
        return bool(_row(db, scope, run_id)["cancelled"])


@contextmanager
def publication_guard(scope: ExecutionScope, run_id: str) -> Iterator[None]:
    """Serialize final publication with cancellation of its private parent job."""
    from backend.services.agent_cancellation import AgentTurnCancelled
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = _row(db, scope, run_id)
        if row["cancelled"]:
            raise AgentTurnCancelled("agent_run_cancelled")
        yield


def resume_data(scope: ExecutionScope, run_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = _row(db, scope, run_id)
        run = AgentRun.model_validate_json(str(row["payload"]))
        request_metadata = json.loads(str(row["request"]))
        if not run.resumable:
            raise ValueError("agent_run_requires_original_entrypoint")
        if run.status not in {"failed", "cancelled", "interrupted", "awaiting_confirmation"}:
            raise ValueError("agent_run_not_resumable")
        if request_metadata.get("operation") == "podcast" and _podcast_busy(db, scope.vault_path, run_id):
            raise ValueError("podcast_generation_already_running")
        saved_scope = _saved_snapshot(db, row).get("scope")
        if saved_scope != scope.model_dump():
            raise PermissionError("agent_execution_scope_changed")
        run = run.model_copy(update={"status": "resuming", "updated_at": time.time()})
        db.execute("UPDATE agent_runs SET cancelled=0,payload=? WHERE run_id=?", (run.model_dump_json(), run_id))
        _claim_worker(db, run_id)
        request = json.loads(str(row["request"]))
        request.pop("_worker_instance", None)
        request.pop("_worker_pid", None)
        request.pop("checkpoint_key", None)
        return request, _saved_snapshot(db, row)


def aggregate(scope: ExecutionScope, run_id: str) -> None:
    """Roll up a batch atomically without losing concurrent phase usage."""
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        parent_row = _row(db, scope, run_id)
        if json.loads(parent_row["request"]).get("mode") != "job":
            return
        parent = AgentRun.model_validate_json(str(parent_row["payload"]))
        children = db.execute(
            """WITH RECURSIVE descendants(id) AS (
                SELECT run_id FROM agent_runs WHERE json_extract(payload, '$.parent_run_id')=?
                UNION ALL SELECT r.run_id FROM agent_runs r JOIN descendants d ON json_extract(r.payload, '$.parent_run_id')=d.id)
                SELECT payload FROM agent_runs WHERE run_id IN (SELECT id FROM descendants)
                AND user_id=? AND workspace_id=? AND vault_path=? AND COALESCE(json_extract(request,'$.mode'),'')!='job'""",
            (run_id, scope.user_id, scope.workspace_id, scope.vault_path),
        ).fetchall()
        runs = [AgentRun.model_validate_json(row[0]) for row in children]
        parent = parent.model_copy(update={
            "input_tokens": sum(run.input_tokens for run in runs),
            "output_tokens": sum(run.output_tokens for run in runs),
            "model_calls": sum(run.model_calls for run in runs),
            "usage_available": bool(runs) and all(run.usage_available for run in runs if run.model_calls),
            "updated_at": time.time(),
        })
        db.execute("UPDATE agent_runs SET payload=? WHERE run_id=?", (parent.model_dump_json(), run_id))


def reserve_model_call(scope: ExecutionScope, run_id: str, limit: int) -> None:
    """Reserve a call atomically, including repairs, against phase and job caps."""
    from backend.services.agent_cancellation import AgentTurnCancelled
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = _row(db, scope, run_id)
        run = AgentRun.model_validate_json(row["payload"])
        if row["cancelled"]:
            raise AgentTurnCancelled("agent_run_cancelled")
        if run.model_calls >= limit:
            raise RuntimeError("agent_operation_call_budget_exceeded")
        ancestor_id = run.parent_run_id
        seen = {run_id}
        while ancestor_id and ancestor_id not in seen:
            seen.add(ancestor_id)
            ancestor_row = _row(db, scope, ancestor_id)
            ancestor = AgentRun.model_validate_json(ancestor_row["payload"])
            metadata = json.loads(ancestor_row["request"])
            if ancestor_row["cancelled"]:
                raise AgentTurnCancelled("agent_run_cancelled")
            cap = metadata.get("max_calls")
            if isinstance(cap, int):
                used = db.execute("""WITH RECURSIVE descendants(id) AS (
                    SELECT run_id FROM agent_runs WHERE run_id=?
                    UNION ALL SELECT r.run_id FROM agent_runs r JOIN descendants d
                    ON json_extract(r.payload, '$.parent_run_id')=d.id)
                    SELECT COALESCE(SUM(json_extract(payload, '$.model_calls')),0)
                    FROM agent_runs WHERE run_id IN (SELECT id FROM descendants)
                    AND COALESCE(json_extract(request, '$.mode'),'')!='job'""", (ancestor_id,)).fetchone()[0]
                if used >= cap:
                    raise RuntimeError("agent_job_call_budget_exceeded")
            ancestor_id = ancestor.parent_run_id
        run = run.model_copy(update={"model_calls": run.model_calls + 1, "updated_at": time.time()})
        db.execute("UPDATE agent_runs SET payload=? WHERE run_id=?", (run.model_dump_json(), run_id))


def phase_checkpoint(scope: ExecutionScope, parent_id: str, key: str) -> AgentRun | None:
    """Reuse only successful phases of the same authorized durable job."""
    if not parent_id:
        return None
    with connect() as db:
        parent = _row(db, scope, parent_id)
        if parent["cancelled"]:
            from backend.services.agent_cancellation import AgentTurnCancelled
            raise AgentTurnCancelled("agent_run_cancelled")
        if json.loads(parent["request"]).get("mode") != "job":
            return None
        row = db.execute("""SELECT payload FROM agent_runs
            WHERE user_id=? AND workspace_id=? AND vault_path=?
            AND json_extract(payload,'$.parent_run_id')=?
            AND json_extract(request,'$.checkpoint_key')=?
            AND json_extract(payload,'$.status')='completed' ORDER BY rowid DESC LIMIT 1""",
            (scope.user_id, scope.workspace_id, scope.vault_path, parent_id, key)).fetchone()
        return AgentRun.model_validate_json(row[0]) if row else None


def work_checkpoint(scope: ExecutionScope, run_id: str, key: str, value: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """Preserve private resumable work independently from expiring trace events."""
    with connect() as db:
        _row(db, scope, run_id)
        db.execute("CREATE TABLE IF NOT EXISTS agent_work_checkpoints (run_id TEXT, checkpoint_key TEXT, payload TEXT NOT NULL, PRIMARY KEY(run_id,checkpoint_key))")
        if value is not None:
            db.execute("INSERT OR REPLACE INTO agent_work_checkpoints VALUES (?,?,?)", (run_id, key, json.dumps(value, ensure_ascii=False)))
        row = db.execute("SELECT payload FROM agent_work_checkpoints WHERE run_id=? AND checkpoint_key=?", (run_id, key)).fetchone()
        return json.loads(row[0]) if row else None


def latest_job(scope: ExecutionScope, operation: str) -> AgentRun | None:
    """Read the latest job for this exact private owner, without a list limit."""
    with connect() as db:
        row = db.execute("""SELECT run_id FROM agent_runs WHERE user_id=? AND workspace_id=? AND vault_path=?
            AND json_extract(request,'$.mode')='job' AND json_extract(request,'$.operation')=? ORDER BY json_extract(payload,'$.updated_at') DESC,rowid DESC LIMIT 1""",
            (scope.user_id, scope.workspace_id, scope.vault_path, operation)).fetchone()
        return AgentRun.model_validate_json(str(_row(db, scope, row[0])["payload"])) if row else None


def claim_feature_job(scope: ExecutionScope, run_id: str, operation: str) -> dict[str, Any]:
    """Only the original entrypoint can claim a stopped job and its frozen snapshot."""
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = _row(db, scope, run_id)
        run = AgentRun.model_validate_json(str(row["payload"]))
        request = json.loads(str(row["request"]))
        if request.get("mode") != "job" or request.get("operation") != operation:
            raise ValueError("agent_job_wrong_entrypoint")
        if run.status not in {"interrupted", "failed"}:
            raise ValueError("agent_job_not_stopped")
        active = db.execute("""SELECT request FROM agent_runs WHERE user_id=? AND workspace_id=? AND vault_path=? AND run_id!=?
            AND json_extract(request,'$.operation')=? AND json_extract(payload,'$.status') IN ('queued','running','resuming')""",
            (scope.user_id, scope.workspace_id, scope.vault_path, run_id, operation)).fetchall()
        if any(_worker_alive(json.loads(entry[0])) for entry in active):
            raise ValueError("meeting_already_running")
        saved = _saved_snapshot(db, row)
        if saved.get("scope") != scope.model_dump():
            raise PermissionError("agent_execution_scope_changed")
        run = run.model_copy(update={"status": "resuming", "error": "", "closed_at": None, "updated_at": time.time()})
        db.execute("UPDATE agent_runs SET payload=? WHERE run_id=?", (run.model_dump_json(), run_id))
        _claim_worker(db, run_id)
        return saved

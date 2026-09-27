"""Scoped immutable execution events; source documents and checkpoints live elsewhere."""
from __future__ import annotations

import hashlib
import json
import re
import time
import math
from typing import Any

from backend.services import agent_execution_store as store

_SECRET = re.compile(r"^(authorization|(?:x[_-]?)?api[_-]?key|(?:access|refresh|id)[_-]?token|token|password|(?:client[_-]?)?secret|(?:set[_-]?)?cookie)$", re.I)


def sanitize(value: Any, path: str = "$") -> tuple[Any, list[str]]:
    hidden: list[str] = []
    if hasattr(value, "to_messages"):
        value = value.to_messages()
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            location = f"{path}.{key}"
            if _SECRET.match(str(key)):
                result[str(key)] = "[redacted]"
                hidden.append(location)
            else:
                result[str(key)], omissions = sanitize(item, location)
                hidden.extend(omissions)
        return result, hidden
    if isinstance(value, (list, tuple)):
        items: list[Any] = []
        for index, item in enumerate(value):
            clean, omissions = sanitize(item, f"{path}[{index}]")
            items.append(clean)
            hidden.extend(omissions)
        return items, hidden
    if isinstance(value, str):
        try:
            nested = json.loads(value) if value.lstrip().startswith(("{", "[")) else None
        except ValueError:
            nested = None
        if isinstance(nested, (dict, list)):
            clean, omissions = sanitize(nested, path)
            if omissions:
                return json.dumps(clean, ensure_ascii=False), omissions
        masked = re.sub(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", value)
        masked = re.sub(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}", "[redacted]", masked)
        return masked, [path] if masked != value else []
    if isinstance(value, float) and not math.isfinite(value):
        return {"unavailable_number": str(value)}, hidden
    if value is None or isinstance(value, (int, float, bool)):
        return value, hidden
    return {"unavailable_type": type(value).__name__}, hidden


def _schema(db: Any) -> None:
    db.execute("CREATE TABLE IF NOT EXISTS agent_trace_blobs (digest TEXT PRIMARY KEY, payload TEXT NOT NULL)")
    db.execute("CREATE TABLE IF NOT EXISTS agent_trace_events (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, created REAL NOT NULL, kind TEXT NOT NULL, digest TEXT NOT NULL)")
    db.execute("CREATE INDEX IF NOT EXISTS agent_trace_run ON agent_trace_events(run_id,id)")
    db.execute("CREATE TABLE IF NOT EXISTS agent_trace_links (root TEXT, leaf TEXT, PRIMARY KEY(root,leaf))")
    db.execute("CREATE TABLE IF NOT EXISTS agent_trace_settings (user_id TEXT, workspace_id TEXT, vault_path TEXT, days INTEGER NOT NULL, PRIMARY KEY(user_id,workspace_id,vault_path))")


def _encode(value: Any, leaves: dict[str, str]) -> Any:
    if isinstance(value, str) and len(value) >= 1000:
        encoded = json.dumps(value, ensure_ascii=False)
        digest = hashlib.sha256(encoded.encode()).hexdigest()
        leaves[digest] = encoded
        return {"blob": digest}
    if isinstance(value, dict):
        return {"map": {key: _encode(item, leaves) for key, item in value.items()}}
    if isinstance(value, list):
        return {"list": [_encode(item, leaves) for item in value]}
    return {"literal": value}


def _decode(value: Any, db: Any) -> Any:
    if "blob" in value:
        row = db.execute("SELECT payload FROM agent_trace_blobs WHERE digest=?", (value["blob"],)).fetchone()
        if row is None:
            raise RuntimeError("agent_trace_blob_missing")
        return json.loads(row[0])
    if "map" in value:
        return {key: _decode(item, db) for key, item in value["map"].items()}
    if "list" in value:
        return [_decode(item, db) for item in value["list"]]
    return value["literal"]


def _prune(db: Any) -> None:
    db.execute("DELETE FROM agent_trace_links WHERE root NOT IN (SELECT digest FROM agent_trace_events)")
    db.execute("DELETE FROM agent_trace_blobs WHERE digest NOT IN (SELECT digest FROM agent_trace_events UNION SELECT leaf FROM agent_trace_links)")
    db.execute("DELETE FROM agent_run_snapshots WHERE digest NOT IN (SELECT json_extract(snapshot,'$._snapshot_ref') FROM agent_runs WHERE json_extract(snapshot,'$._snapshot_ref') IS NOT NULL)")


def _discard_finished_input(db: Any, run_id: str, payload: dict[str, Any]) -> None:
    if payload.get("status") != "completed":
        return
    row = db.execute("SELECT request FROM agent_runs WHERE run_id=?", (run_id,)).fetchone()
    original = json.loads(row[0])
    retained = {key: original[key] for key in ("mode", "checkpoint_key", "_worker_pid", "_worker_instance") if key in original}
    db.execute("UPDATE agent_runs SET request=?,snapshot='{}' WHERE run_id=?", (json.dumps(retained), run_id))
    if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='agent_team_artifacts'").fetchone():
        db.execute("DELETE FROM agent_team_artifacts WHERE run_id=?", (run_id,))


def retention(scope: Any, days: int | None = None) -> int:
    if days is not None and not 1 <= days <= 3650:
        raise ValueError("agent_trace_retention_invalid")
    key = (scope.user_id, scope.workspace_id, scope.vault_path)
    with store.connect() as db:
        _schema(db)
        if days is not None:
            db.execute("INSERT OR REPLACE INTO agent_trace_settings VALUES (?,?,?,?)", (*key, days))
        row = db.execute("SELECT days FROM agent_trace_settings WHERE user_id=? AND workspace_id=? AND vault_path=?", key).fetchone()
        return int(row[0]) if row else 30


def expire(scope: Any) -> None:
    cutoff = time.time() - retention(scope) * 86400
    with store.connect() as db:
        _schema(db)
        rows = db.execute("SELECT run_id,payload FROM agent_runs WHERE user_id=? AND workspace_id=? AND vault_path=?", (scope.user_id, scope.workspace_id, scope.vault_path)).fetchall()
        for row in rows:
            payload = json.loads(row["payload"])
            if payload.get("trace_state") in {"expired", "deleted"}:
                continue
            if payload.get("status") not in {"completed", "failed", "cancelled"} or not payload.get("closed_at") or payload["closed_at"] > cutoff:
                continue
            db.execute("DELETE FROM agent_trace_events WHERE run_id=?", (row["run_id"],))
            payload["trace_state"] = "expired"
            _discard_finished_input(db, row["run_id"], payload)
            db.execute("UPDATE agent_runs SET payload=? WHERE run_id=?", (json.dumps(payload), row["run_id"]))
        _prune(db)


def maintain() -> None:
    """Apply each owner's retention policy even when history is never opened."""
    from backend.services.agent_execution_models import ExecutionScope
    with store.connect() as db:
        scopes = db.execute("SELECT DISTINCT user_id,workspace_id,vault_path FROM agent_runs").fetchall()
    for row in scopes:
        expire(ExecutionScope(user_id=row["user_id"], workspace_id=row["workspace_id"], vault_path=row["vault_path"], role="owner"))


def append(scope: Any, run_id: str, kind: str, payload: Any) -> None:
    clean, hidden = sanitize(payload)
    leaves: dict[str, str] = {}
    encoded = json.dumps({"encoding": "tree-v1", "payload": _encode({"value": clean, "redactions": hidden}, leaves)}, ensure_ascii=False, sort_keys=True, allow_nan=False)
    digest = hashlib.sha256(encoded.encode()).hexdigest()
    with store.connect() as db:
        store._row(db, scope, run_id)
        _schema(db)
        for leaf, content in leaves.items():
            db.execute("INSERT OR IGNORE INTO agent_trace_blobs VALUES (?,?)", (leaf, content))
            db.execute("INSERT OR IGNORE INTO agent_trace_links VALUES (?,?)", (digest, leaf))
        db.execute("INSERT OR IGNORE INTO agent_trace_blobs VALUES (?,?)", (digest, encoded))
        db.execute("INSERT INTO agent_trace_events(run_id,created,kind,digest) VALUES (?,?,?,?)", (run_id, time.time(), kind, digest))


def events(scope: Any, run_id: str, *, after: int = 0, limit: int = 100) -> dict[str, Any]:
    expire(scope)
    with store.connect() as db:
        store._row(db, scope, run_id)
        _schema(db)
        rows = db.execute("SELECT e.*, b.payload FROM agent_trace_events e JOIN agent_trace_blobs b ON b.digest=e.digest WHERE e.run_id=? AND e.id>? ORDER BY e.id LIMIT ?", (run_id, after, max(1, min(500, limit)))).fetchall()
        result = []
        for row in rows:
            encoded = json.loads(row["payload"])
            payload = _decode(encoded["payload"], db) if encoded.get("encoding") == "tree-v1" else encoded
            result.append({"id": row["id"], "created_at": row["created"], "kind": row["kind"], "digest": row["digest"], **payload})
        return {"events": result, "next_cursor": rows[-1]["id"] if rows else after}


def delete(scope: Any, run_id: str) -> None:
    with store.connect() as db:
        run = store._row(db, scope, run_id)
        if json.loads(run["payload"])["status"] in {"queued", "running", "resuming"}:
            raise ValueError("agent_trace_execution_active")
        _schema(db)
        db.execute("DELETE FROM agent_trace_events WHERE run_id=?", (run_id,))
        payload = json.loads(run["payload"])
        payload["trace_state"] = "deleted"
        _discard_finished_input(db, run_id, payload)
        db.execute("UPDATE agent_runs SET payload=? WHERE run_id=?", (json.dumps(payload), run_id))
        _prune(db)


from contextvars import ContextVar
metadata_only_trace: ContextVar[bool] = ContextVar("metadata_only_trace", default=False)


def record(kind: str, payload: Any) -> None:
    from backend.services.agent_execution import _run
    from backend.services.agent_execution_scope import current_scope
    if _run.get():
        if metadata_only_trace.get():
            payload = {"metadata_only": True}
        append(current_scope(), _run.get(), kind, payload)

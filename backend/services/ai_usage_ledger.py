"""Durable metadata-only accounting shared by every model provider."""
from __future__ import annotations

import json
import logging
import os
import shutil
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterator

from backend.config.data_dir import resolve_data_dir

log = logging.getLogger(__name__)


def decimal_cost(value: Any) -> Decimal | None:
    try:
        cost = Decimal(str(value))
        return cost if cost.is_finite() and cost >= 0 else None
    except (InvalidOperation, ValueError, TypeError):
        return None


def context_metadata() -> dict[str, str]:
    """Snapshot attribution at invocation time; never retain source contents."""
    result = {"agent_id": "system", "agent_name": "", "operation": "", "origin": "system", "run_id": "", "workspace_id": "", "user_id": "", "profile": "unrated"}
    try:
        from backend.services.agent_execution import _run, _snapshot
        from backend.services.agent_execution_scope import current_scope
        from backend.services import agent_execution_store
        scope = current_scope()
        result.update(workspace_id=scope.workspace_id, user_id=scope.user_id)
        if _run.get():
            row = agent_execution_store.read(scope, _run.get())
            result.update(run_id=row.run_id, agent_id=row.agent_id, operation=row.operation, origin=row.origin)
        snapshot = _snapshot.get()
        if snapshot:
            result["agent_name"] = str(snapshot.profile.get("name") or snapshot.agent_id)
    except (RuntimeError, ValueError, PermissionError):
        pass
    return result


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    root = resolve_data_dir(create=True)
    db = sqlite3.connect(root / "llm_usage.sqlite", timeout=30)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA busy_timeout=30000")
        db.execute("CREATE TABLE IF NOT EXISTS usage_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute("""CREATE TABLE IF NOT EXISTS usage_calls (
            id TEXT PRIMARY KEY, created REAL NOT NULL, period TEXT NOT NULL,
            provider TEXT NOT NULL, model_id TEXT NOT NULL, agent_id TEXT NOT NULL,
            agent_name TEXT NOT NULL, operation TEXT NOT NULL, origin TEXT NOT NULL,
            profile TEXT NOT NULL, run_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
            user_id TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
            cached_tokens INTEGER, reasoning_tokens INTEGER, duration_ms REAL NOT NULL,
            status TEXT NOT NULL, cost_usd TEXT, cost_source TEXT NOT NULL)""")
        db.execute("CREATE INDEX IF NOT EXISTS usage_calls_date ON usage_calls(created)")
        db.execute("CREATE INDEX IF NOT EXISTS usage_calls_scope ON usage_calls(workspace_id,user_id,created)")
        db.execute("""CREATE TABLE IF NOT EXISTS usage_legacy (
            period TEXT NOT NULL, provider TEXT NOT NULL, model_id TEXT NOT NULL,
            input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
            cost_usd TEXT NOT NULL, PRIMARY KEY(period,provider,model_id))""")
        # Serialize schema creation/migration across processes. The JSON becomes
        # a preserved source, never a second live writer after migration.
        db.execute("BEGIN IMMEDIATE")
        if not db.execute("SELECT 1 FROM usage_meta WHERE key='legacy_imported'").fetchone():
            path = root / "cache" / "llm_usage.json"
            try:
                from backend.config.app_config import load_params
                base = load_params(strict_env=False).paths.get("LOCAL_CACHE")
                if base:
                    path = Path(base) / "llm_usage.json"
            except Exception:
                pass
            if path.exists():
                payload = json.loads(path.read_text(encoding="utf-8"))
                backup = path.with_name("llm_usage.before-sqlite.json")
                if not backup.exists():
                    shutil.copy2(path, backup)
                for period, models in payload.items():
                    for key, value in models.items():
                        provider, _, model = key.partition(":")
                        row = value if isinstance(value, dict) else {"in": value}
                        cost = decimal_cost(row.get("cost_usd", 0)) or Decimal(0)
                        db.execute("INSERT OR IGNORE INTO usage_legacy VALUES (?,?,?,?,?,?)", (period, provider, model, int(row.get("in") or 0), int(row.get("out") or 0), str(cost)))
            db.execute("INSERT INTO usage_meta VALUES ('legacy_imported',?)", (str(time.time()),))
        db.commit()
        os.chmod(root / "llm_usage.sqlite", 0o600)
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def write_call(*, provider: str, model_id: str, input_tokens: int | None,
               output_tokens: int | None, cost_usd: Any = None,
               cost_source: str = "unknown", call_id: str | None = None,
               created: float | None = None, period: str | None = None,
               cached_tokens: int | None = None, reasoning_tokens: int | None = None,
               duration_ms: float = 0, status: str = "completed",
               metadata: dict[str, str] | None = None) -> bool:
    attribution = {**context_metadata(), **(metadata or {})}
    stamp = created if created is not None else time.time()
    cost = decimal_cost(cost_usd)
    with connect() as db:
        cursor = db.execute("""INSERT OR IGNORE INTO usage_calls VALUES
            (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
            call_id or uuid.uuid4().hex, stamp,
            period or datetime.fromtimestamp(stamp).strftime("%Y-%m"),
            provider, model_id, attribution["agent_id"], attribution["agent_name"],
            attribution["operation"], attribution["origin"], attribution["profile"],
            attribution["run_id"], attribution["workspace_id"], attribution["user_id"],
            input_tokens, output_tokens, cached_tokens, reasoning_tokens,
            duration_ms, status, str(cost) if cost is not None else None,
            cost_source if cost is not None else "unknown"))
        return bool(cursor.rowcount)


def monthly() -> dict[str, dict[str, dict[str, Any]]]:
    """Compatibility projection for the existing router and budget APIs."""
    totals: dict[str, dict[str, dict[str, Any]]] = {}
    with connect() as db:
        records = db.execute("SELECT period,provider,model_id,input_tokens,output_tokens,cost_usd FROM usage_calls").fetchall()
        records += db.execute("SELECT * FROM usage_legacy").fetchall()
    for row in records:
        entry = totals.setdefault(row["period"], {}).setdefault(f'{row["provider"]}:{row["model_id"]}', {"in": 0, "out": 0, "cost_usd": Decimal(0)})
        entry["in"] += row["input_tokens"] or 0
        entry["out"] += row["output_tokens"] or 0
        entry["cost_usd"] += decimal_cost(row["cost_usd"]) or Decimal(0)
    for bucket in totals.values():
        for entry in bucket.values():
            entry["cost_usd"] = float(entry["cost_usd"])
    return totals

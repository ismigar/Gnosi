"""Two-tier active watchdog for detecting stuck runs, bounded safe retries, and redacted diagnostics."""
from __future__ import annotations

import os
import sqlite3
import time
import uuid
from collections.abc import Awaitable, Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.agent.provider_resilience import is_retryable_provider_error
from backend.config.data_dir import resolve_data_dir
from backend.services.agent_execution_models import AgentRun, ExecutionScope
from backend.services.agent_execution_scope import revalidate_scope
from backend.services.agent_execution_trace import sanitize

AlertKind = Literal["stale_run", "transient_failure", "persistent_failure"]
AlertStatus = Literal["open", "retried", "dismissed"]
SuggestedAction = Literal["resume", "switch_model", "inspect"]


class WatchdogAlert(BaseModel):
    alert_id: str
    run_id: str
    agent_id: str
    operation: str
    kind: AlertKind
    status: AlertStatus
    suggested_action: SuggestedAction
    summary: str
    retry_count: int = 0
    last_retry_at: float | None = None
    created_at: float
    updated_at: float


class WatchdogSweepRequest(BaseModel):
    stale_after_seconds: int = Field(default=900, ge=60, le=86_400)
    cooldown_seconds: int = Field(default=600, ge=30, le=86_400)
    max_auto_retries: int = Field(default=2, ge=0, le=3)
    auto_retry: bool = False


class WatchdogSweepResult(BaseModel):
    scanned_runs: int
    new_alerts: int
    auto_retried: int
    open_alerts: list[WatchdogAlert]


RunLister = Callable[[ExecutionScope], list[AgentRun]]
RunResumer = Callable[[ExecutionScope, str], Awaitable[Any]]


def _db_path() -> Path:
    root = resolve_data_dir(create=True)
    root.mkdir(parents=True, exist_ok=True)
    return root / "agent_watchdog.sqlite"


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    path = _db_path()
    conn = sqlite3.connect(str(path), timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS watchdog_alerts (
            alert_id TEXT PRIMARY KEY,
            vault_path TEXT NOT NULL,
            workspace_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            operation TEXT NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            suggested_action TEXT NOT NULL,
            summary TEXT NOT NULL,
            retry_count INTEGER NOT NULL DEFAULT 0,
            last_retry_at REAL,
            created_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            UNIQUE(vault_path, workspace_id, user_id, run_id)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_watchdog_scope ON watchdog_alerts (vault_path, workspace_id, user_id, updated_at DESC)"
    )
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _row_to_alert(row: sqlite3.Row) -> WatchdogAlert:
    return WatchdogAlert(
        alert_id=str(row["alert_id"]),
        run_id=str(row["run_id"]),
        agent_id=str(row["agent_id"]),
        operation=str(row["operation"]),
        kind=row["kind"],
        status=row["status"],
        suggested_action=row["suggested_action"],
        summary=str(row["summary"]),
        retry_count=int(row["retry_count"]),
        last_retry_at=float(row["last_retry_at"]) if row["last_retry_at"] is not None else None,
        created_at=float(row["created_at"]),
        updated_at=float(row["updated_at"]),
    )


def _sanitized_summary(text: str) -> str:
    clean, _ = sanitize(text[:800])
    return str(clean)[:500]


def _classify_run(run: AgentRun, *, now: float, stale_after_seconds: int) -> tuple[AlertKind, SuggestedAction, str] | None:
    if run.status in {"running", "queued", "resuming"}:
        age = max(0.0, now - float(run.updated_at or run.created_at or now))
        if age >= stale_after_seconds:
            return (
                "stale_run",
                "resume" if run.resumable else "inspect",
                f"Run has been in '{run.status}' state for {int(age)}s without progress.",
            )
        return None
    if run.status in {"failed", "interrupted"}:
        error_text = str(run.error or "")
        if run.resumable and is_retryable_provider_error(RuntimeError(error_text)):
            return (
                "transient_failure",
                "resume",
                _sanitized_summary(f"Transient provider failure: {error_text or run.status}"),
            )
        lowered = error_text.lower()
        suggested: SuggestedAction = (
            "switch_model"
            if any(marker in lowered for marker in ("429", "quota", "rate limit", "model_not_found", "context"))
            else "inspect"
        )
        return (
            "persistent_failure",
            suggested,
            _sanitized_summary(f"Run ended with '{run.status}': {error_text or 'no details'}"),
        )
    return None


def list_alerts(scope: ExecutionScope, *, include_dismissed: bool = False) -> list[WatchdogAlert]:
    status_clause = "" if include_dismissed else " AND status != 'dismissed'"
    with _connect() as conn:
        rows = conn.execute(
            f"""
            SELECT * FROM watchdog_alerts
             WHERE vault_path = ? AND workspace_id = ? AND user_id = ?{status_clause}
             ORDER BY updated_at DESC
             LIMIT 100
            """,
            (scope.vault_path, scope.workspace_id, scope.user_id),
        ).fetchall()
    return [_row_to_alert(row) for row in rows]


def dismiss_alert(scope: ExecutionScope, alert_id: str) -> WatchdogAlert:
    now = time.time()
    with _connect() as conn:
        updated = conn.execute(
            """
            UPDATE watchdog_alerts
               SET status = 'dismissed', updated_at = ?
             WHERE alert_id = ? AND vault_path = ? AND workspace_id = ? AND user_id = ?
            """,
            (now, alert_id, scope.vault_path, scope.workspace_id, scope.user_id),
        ).rowcount
        if updated == 0:
            raise LookupError("watchdog_alert_not_found")
        row = conn.execute(
            "SELECT * FROM watchdog_alerts WHERE alert_id = ?",
            (alert_id,),
        ).fetchone()
    return _row_to_alert(row)


def _default_run_lister(scope: ExecutionScope) -> list[AgentRun]:
    from backend.services import agent_execution_store as store

    return store.list_runs(scope)


async def _default_run_resumer(_scope: ExecutionScope, run_id: str) -> Any:
    from backend.services.agent_execution import resume_run

    return await resume_run(run_id)


async def sweep_scope(
    scope: ExecutionScope,
    request: WatchdogSweepRequest | None = None,
    *,
    now: float | None = None,
    run_lister: RunLister | None = None,
    run_resumer: RunResumer | None = None,
) -> WatchdogSweepResult:
    """Inspect scoped agent runs, record alerts, and perform bounded retries on safe transient failures."""
    revalidate_scope(scope)
    cfg = request or WatchdogSweepRequest()
    ts = time.time() if now is None else now
    runs = (run_lister or _default_run_lister)(scope)
    resumer = run_resumer or _default_run_resumer
    new_alerts = 0
    auto_retried = 0

    for run in runs:
        classified = _classify_run(run, now=ts, stale_after_seconds=cfg.stale_after_seconds)
        if classified is None:
            continue
        kind, suggested, summary = classified
        with _connect() as conn:
            existing = conn.execute(
                """
                SELECT * FROM watchdog_alerts
                 WHERE vault_path = ? AND workspace_id = ? AND user_id = ? AND run_id = ?
                """,
                (scope.vault_path, scope.workspace_id, scope.user_id, run.run_id),
            ).fetchone()
            if existing is None:
                alert_id = uuid.uuid4().hex
                conn.execute(
                    """
                    INSERT INTO watchdog_alerts
                        (alert_id, vault_path, workspace_id, user_id, run_id, agent_id, operation,
                         kind, status, suggested_action, summary, retry_count, last_retry_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 0, NULL, ?, ?)
                    """,
                    (
                        alert_id,
                        scope.vault_path,
                        scope.workspace_id,
                        scope.user_id,
                        run.run_id,
                        str(run.agent_id or ""),
                        str(run.operation or ""),
                        kind,
                        suggested,
                        summary,
                        ts,
                        ts,
                    ),
                )
                new_alerts += 1
                alert = WatchdogAlert(
                    alert_id=alert_id,
                    run_id=run.run_id,
                    agent_id=str(run.agent_id or ""),
                    operation=str(run.operation or ""),
                    kind=kind,
                    status="open",
                    suggested_action=suggested,
                    summary=summary,
                    retry_count=0,
                    last_retry_at=None,
                    created_at=ts,
                    updated_at=ts,
                )
            else:
                alert = _row_to_alert(existing)
                if alert.status == "dismissed":
                    continue

        can_retry = (
            cfg.auto_retry
            and kind == "transient_failure"
            and run.resumable
            and alert.retry_count < cfg.max_auto_retries
            and (alert.last_retry_at is None or (ts - alert.last_retry_at) >= cfg.cooldown_seconds)
        )
        if can_retry:
            revalidate_scope(scope)
            try:
                await resumer(scope, run.run_id)
                next_retry_count = alert.retry_count + 1
                with _connect() as conn:
                    conn.execute(
                        """
                        UPDATE watchdog_alerts
                           SET status = 'retried', retry_count = ?, last_retry_at = ?, updated_at = ?
                         WHERE alert_id = ?
                        """,
                        (next_retry_count, ts, ts, alert.alert_id),
                    )
                auto_retried += 1
            except PermissionError:
                raise
            except Exception as exc:  # noqa: BLE001
                err_summary = _sanitized_summary(f"{alert.summary} (auto-retry failed: {exc})")
                with _connect() as conn:
                    conn.execute(
                        """
                        UPDATE watchdog_alerts
                           SET retry_count = ?, last_retry_at = ?, summary = ?, updated_at = ?
                         WHERE alert_id = ?
                        """,
                        (alert.retry_count + 1, ts, err_summary, ts, alert.alert_id),
                    )

    return WatchdogSweepResult(
        scanned_runs=len(runs),
        new_alerts=new_alerts,
        auto_retried=auto_retried,
        open_alerts=list_alerts(scope, include_dismissed=False),
    )

"""Tests for the active two-tier agent watchdog."""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from backend.services.agent_execution_models import AgentRun, ExecutionScope
from backend.services.agent_watchdog import (
    WatchdogSweepRequest,
    dismiss_alert,
    list_alerts,
    sweep_scope,
)


def _scope(tmp_path: Path, user_id: str = "u1") -> ExecutionScope:
    return ExecutionScope(user_id=user_id, workspace_id="w1", role="owner", vault_path=str(tmp_path))


def _run(
    run_id: str,
    *,
    status: str = "failed",
    resumable: bool = True,
    error: str = "",
    updated_at: float = 1_000.0,
) -> AgentRun:
    return AgentRun(
        run_id=run_id,
        agent_id="writer",
        skill_id="s1",
        operation="podcast",
        status=status,  # type: ignore[arg-type]
        origin="automation",
        resumable=resumable,
        error=error,
        created_at=900.0,
        updated_at=updated_at,
    )


def test_watchdog_detects_stale_and_transient_runs_with_cooldown_and_retry_cap(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr("backend.services.agent_watchdog.revalidate_scope", lambda _s: None)
    scope = _scope(tmp_path)
    retried_ids: list[str] = []

    runs = [
        _run("r-stale", status="running", resumable=True, updated_at=100.0),
        _run("r-transient", status="failed", resumable=True, error="HTTP 429 rate limit exceeded", updated_at=1_500.0),
        _run("r-nonresumable", status="failed", resumable=False, error="HTTP 503 service unavailable", updated_at=1_500.0),
    ]

    async def fake_resumer(_s: ExecutionScope, run_id: str) -> None:
        retried_ids.append(run_id)

    req = WatchdogSweepRequest(stale_after_seconds=600, cooldown_seconds=300, max_auto_retries=1, auto_retry=True)
    res1 = asyncio.run(sweep_scope(scope, req, now=2_000.0, run_lister=lambda _s: runs, run_resumer=fake_resumer))
    assert res1.scanned_runs == 3
    assert res1.new_alerts == 3
    assert res1.auto_retried == 1
    assert retried_ids == ["r-transient"]

    # Immediate second sweep respects retry cap (max_auto_retries=1) and does not duplicate alerts
    res2 = asyncio.run(sweep_scope(scope, req, now=2_500.0, run_lister=lambda _s: runs, run_resumer=fake_resumer))
    assert res2.new_alerts == 0
    assert res2.auto_retried == 0
    assert retried_ids == ["r-transient"]


def test_watchdog_redacts_secrets_dismisses_and_isolates_scopes(tmp_path: Path, monkeypatch: Any) -> None:
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setattr("backend.services.agent_watchdog.revalidate_scope", lambda _s: None)
    scope = _scope(tmp_path, "u1")
    other = _scope(tmp_path, "u2")
    runs = [_run("r-secret", status="failed", resumable=False, error="Authorization: Bearer sk-secret-token-1234567890")]

    res = asyncio.run(sweep_scope(scope, WatchdogSweepRequest(), now=2_000.0, run_lister=lambda _s: runs))
    assert len(res.open_alerts) == 1
    assert "sk-secret-token-1234567890" not in res.open_alerts[0].summary
    assert list_alerts(other) == []

    alert_id = res.open_alerts[0].alert_id
    with pytest.raises(LookupError):
        dismiss_alert(other, alert_id)
    dismissed = dismiss_alert(scope, alert_id)
    assert dismissed.status == "dismissed"
    assert list_alerts(scope) == []

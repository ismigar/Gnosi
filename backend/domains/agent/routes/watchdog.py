"""Scoped API routes for the active two-tier agent watchdog."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from backend.services.agent_execution_scope import current_scope
from backend.services.agent_watchdog import (
    WatchdogAlert as WatchdogAlert,
    WatchdogSweepRequest as WatchdogSweepRequest,
    WatchdogSweepResult as WatchdogSweepResult,
    dismiss_alert,
    list_alerts,
    sweep_scope,
)

router = APIRouter()


@router.get("/watchdog/alerts", response_model=list[WatchdogAlert])
def get_watchdog_alerts(include_dismissed: bool = Query(default=False)) -> list[WatchdogAlert]:
    return list_alerts(current_scope(), include_dismissed=include_dismissed)


@router.post("/watchdog/sweep", response_model=WatchdogSweepResult)
async def post_watchdog_sweep(payload: WatchdogSweepRequest | None = None) -> WatchdogSweepResult:
    scope = current_scope()
    if scope.role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="watchdog_admin_required")
    try:
        return await sweep_scope(scope, payload or WatchdogSweepRequest())
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/watchdog/alerts/{alert_id}/dismiss", response_model=WatchdogAlert)
def post_dismiss_watchdog_alert(alert_id: str) -> WatchdogAlert:
    scope = current_scope()
    if scope.role not in {"owner", "admin", "editor"}:
        raise HTTPException(status_code=403, detail="watchdog_editor_required")
    try:
        return dismiss_alert(scope, alert_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

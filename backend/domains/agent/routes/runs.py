"""Authenticated access to principal operation activity and explicit retries."""
from fastapi import APIRouter, Depends, HTTPException, Query

from backend.services import agent_execution_store as store
from backend.services.agent_execution import cancel_run, resume_run
from backend.services.agent_execution_models import AgentRun
from backend.services.agent_execution_scope import bind_request_scope, current_scope
from backend.services.plugin_access import require_plugins

router = APIRouter(prefix="/api/agent/runs", tags=["Agent runs"], dependencies=[
    Depends(require_plugins("ai-platform")), Depends(bind_request_scope),
])


@router.get("", response_model=list[AgentRun])
def runs(limit: int = Query(default=50, ge=1, le=200)) -> list[AgentRun]:
    return store.list_runs(current_scope(), limit)


@router.get("/{run_id}", response_model=AgentRun)
def run(run_id: str) -> AgentRun:
    try:
        return store.read(current_scope(), run_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="agent_run_not_found") from exc


@router.post("/{run_id}/cancel", response_model=AgentRun)
def cancel(run_id: str) -> AgentRun:
    try:
        return cancel_run(run_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="agent_run_not_found") from exc


@router.post("/{run_id}/resume", response_model=AgentRun)
async def resume(run_id: str) -> AgentRun:
    try:
        return await resume_run(run_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="agent_run_not_found") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

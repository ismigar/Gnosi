"""Scoped API routes for multi-step asynchronous agent workflow chains."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from backend.services.agent_execution_scope import current_scope
from backend.services.agent_workflow_chains import (
    WorkflowChainConflictError,
    WorkflowChainCreate as WorkflowChainCreate,
    WorkflowChainRun as WorkflowChainRun,
    advance_chain,
    cancel_chain,
    create_chain,
    get_chain,
    list_chains,
)

router = APIRouter()


@router.get("/chains", response_model=list[WorkflowChainRun])
def get_workflow_chains(limit: int = Query(default=50, ge=1, le=200)) -> list[WorkflowChainRun]:
    return list_chains(current_scope(), limit=limit)


@router.post("/chains", response_model=WorkflowChainRun)
def post_workflow_chain(payload: WorkflowChainCreate) -> WorkflowChainRun:
    scope = current_scope()
    if scope.role not in {"owner", "admin", "editor"}:
        raise HTTPException(status_code=403, detail="workflow_chain_editor_required")
    try:
        return create_chain(scope, payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/chains/{chain_id}", response_model=WorkflowChainRun)
def get_workflow_chain(chain_id: str) -> WorkflowChainRun:
    try:
        return get_chain(current_scope(), chain_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/chains/{chain_id}/run", response_model=WorkflowChainRun)
async def run_workflow_chain(chain_id: str) -> WorkflowChainRun:
    scope = current_scope()
    if scope.role not in {"owner", "admin", "editor"}:
        raise HTTPException(status_code=403, detail="workflow_chain_editor_required")
    try:
        return await advance_chain(scope, chain_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except WorkflowChainConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/chains/{chain_id}/cancel", response_model=WorkflowChainRun)
def cancel_workflow_chain(chain_id: str) -> WorkflowChainRun:
    scope = current_scope()
    if scope.role not in {"owner", "admin", "editor"}:
        raise HTTPException(status_code=403, detail="workflow_chain_editor_required")
    try:
        return cancel_chain(scope, chain_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

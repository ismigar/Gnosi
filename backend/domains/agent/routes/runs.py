"""Authenticated access to principal operation activity and explicit retries."""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Any
from fastapi.responses import StreamingResponse
from collections.abc import Iterator
import json

from backend.services import agent_execution_store as store
from backend.services.agent_execution import cancel_run, resume_run
from backend.services.agent_execution_models import AgentRun
from backend.services.agent_execution_scope import bind_request_scope, current_scope
from backend.services.plugin_access import require_plugins

router = APIRouter(prefix="/api/agent/runs", tags=["Agent runs"], dependencies=[
    Depends(require_plugins("ai-platform")), Depends(bind_request_scope),
])


class TraceRetention(BaseModel):
    days: int = Field(default=30, ge=1, le=3650)


class TraceEvent(BaseModel):
    id: int
    created_at: float
    kind: str
    digest: str
    value: Any
    redactions: list[str]


class TracePage(BaseModel):
    events: list[TraceEvent]
    next_cursor: int


class BehaviorPreviewRequest(BaseModel):
    profile: dict[str, Any]
    active_skill_ids: list[str] | None = None


class OperationBindingRequest(BaseModel):
    agent_id: str = Field(min_length=1)
    expected_agent_id: str


class OperationBindingResponse(BaseModel):
    agent_id: str
    skill_id: str


class BehaviorPreviewResponse(BaseModel):
    instructions: str
    context: str
    sources: list[dict[str, Any]]
    system: str
    skills: list[dict[str, Any]]
    operations: list[dict[str, str]]
    catalog_revision: str
    missing_skill_ids: list[str]
    system_resources: list[dict[str, str]]


@router.post("/preview", response_model=BehaviorPreviewResponse)
def preview(payload: BehaviorPreviewRequest) -> dict[str, Any]:
    from pathlib import Path
    from backend.services.agent_skill_catalog import resolve_agent_runtime
    from backend.services.agent_operation_catalog import OPERATIONS, skill_id
    from backend.services.agent_behavior import resource, inventory
    from backend.services.agent_learning_packages import runtime_instructions
    from backend.config.app_config import load_params
    bindings = load_params(strict_env=False).ai.get("operation_bindings") or {}
    try:
        runtime = resolve_agent_runtime(payload.profile, vault_path=Path(current_scope().vault_path), active_skill_ids=payload.active_skill_ids)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {
        "instructions": str(payload.profile.get("persona") or ""),
        "context": str(payload.profile.get("context") or ""),
        "sources": payload.profile.get("context_refs") or [],
        "system": resource("system/data-boundary.md"),
        "skills": [{"id": entry.descriptor.id, "effective_id": entry.descriptor.metadata.get("effective_skill_id", entry.descriptor.id),
                    "name": entry.descriptor.name, "instructions": runtime_instructions(entry.descriptor),
                    "version": entry.descriptor.version, "revision": entry.revision,
                    "available": entry.available, "tool_ids": entry.descriptor.tool_ids}
                   for entry in runtime.skills],
        "operations": [{"operation": key, "skill_id": skill_id(key), "name": name, "owner": owner,
                        "agent_id": str(bindings.get(key, {}).get("agent_id", f"builtin.{owner}.default"))}
                       for key, (owner, name, _) in OPERATIONS.items() if skill_id(key) in runtime.assigned_skill_ids],
        "catalog_revision": runtime.catalog_revision, "missing_skill_ids": list(runtime.missing_skill_ids),
        "system_resources": [{**item, "text": resource(item["path"])} for item in inventory() if item["path"].startswith("system/")],
    }


@router.put("/bindings/{operation}", response_model=OperationBindingResponse)
def update_binding(operation: str, payload: OperationBindingRequest) -> dict[str, str]:
    if current_scope().role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="agent_configuration_admin_required")
    from backend.config.app_config import load_params
    from backend.services.agent_skill_assignments import AgentSkillAssignmentStore
    cfg = load_params(strict_env=False)
    assignments = AgentSkillAssignmentStore(cfg.params_source, cfg.params)
    try:
        return assignments.bind_operation(operation, payload.agent_id, payload.expected_agent_id)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/trace-settings", response_model=TraceRetention)
def trace_settings() -> dict[str, Any]:
    from backend.services.agent_execution_trace import retention
    return {"days": retention(current_scope())}


@router.put("/trace-settings", response_model=TraceRetention)
def update_trace_settings(payload: TraceRetention) -> dict[str, Any]:
    from backend.services.agent_execution_trace import retention, expire
    days = retention(current_scope(), payload.days)
    expire(current_scope())
    return {"days": days}


@router.get("/{run_id}/trace", response_model=TracePage)
def trace(run_id: str, after: int = Query(default=0, ge=0), limit: int = Query(default=100, ge=1, le=500)) -> dict[str, Any]:
    from backend.services.agent_execution_trace import events
    try:
        return events(current_scope(), run_id, after=after, limit=limit)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="agent_run_not_found") from exc


@router.delete("/{run_id}/trace")
def delete_trace(run_id: str) -> dict[str, Any]:
    from backend.services.agent_execution_trace import delete
    try:
        delete(current_scope(), run_id)
        return {"deleted": True}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="agent_run_not_found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/{run_id}/trace/export")
def export_trace(run_id: str) -> StreamingResponse:
    from backend.services.agent_execution_trace import events
    scope = current_scope()
    try:
        store.read(scope, run_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="agent_run_not_found") from exc
    def stream() -> Iterator[str]:
        yield '{"events":['
        cursor, first = 0, True
        while True:
            page = events(scope, run_id, after=cursor, limit=500)
            for event in page["events"]:
                yield ("" if first else ",") + json.dumps(event, ensure_ascii=False)
                first = False
            if len(page["events"]) < 500:
                break
            cursor = page["next_cursor"]
        yield "]}"
    return StreamingResponse(stream(), media_type="application/json", headers={"Content-Disposition": 'attachment; filename="agent-trace.json"'})


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

"""Catalog, assignment and automation routes for agent skills."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict

from backend.domains.configuration.agent.contracts import (
    AgentSkillAssignmentPayload,
    AutomationWritePayload,
    CloneSkillPayload,
    UserSkillWritePayload,
)
from backend.domains.configuration.agent.governance_routes import (
    _assignment_store as _default_assignment_store,
)
from backend.domains.configuration.agent.governance_routes import (
    _automation_scope,
    _metadata,
    _store_for,
)
from backend.domains.configuration.agent.router import router
from backend.models.agent_skills import (
    CatalogStatus,
    SkillDescriptor,
    SkillKind,
    ToolEffect,
)
from backend.services.agent_skill_assignments import (
    AgentAssignmentConflictError,
    AgentNotFoundError,
)
from backend.services.agent_skill_catalog import (
    CatalogConflictError,
    CatalogProviderError,
)
from backend.services.agent_skill_catalog import (
    get_skill_catalog as _default_get_skill_catalog,
)
from backend.services.agent_skill_catalog import (
    get_tool_catalog as _default_get_tool_catalog,
)
from backend.services.capability_automations import (
    AutomationConflictError,
    delete_automation,
    get_automation,
    list_automations,
    list_runs,
    run_automation,
    save_automation,
)
from backend.services.plugin_access import require_plugins
from backend.services.user_skill_store import (
    UserSkillConflictError,
    UserSkillNotFoundError,
    UserSkillStoreError,
)
from backend.services.workspace_service import (
    WorkspaceContext,
    get_workspace_context,
    require_role,
)

_CatalogProvider = Callable[[], Any]
_AssignmentProvider = Callable[[], Any]
_skill_catalog_provider: _CatalogProvider = _default_get_skill_catalog
_tool_catalog_provider: _CatalogProvider = _default_get_tool_catalog
_assignment_provider: _AssignmentProvider = _default_assignment_store


class AgentSkillCatalogItemResponse(SkillDescriptor):
    """Flattened effective skill descriptor returned by the catalog route."""

    model_config = ConfigDict(extra="forbid")

    available: bool
    missing_tool_ids: list[str]
    effects: list[ToolEffect]
    editable: bool
    deletable: bool
    revision: str


class AgentSkillCatalogIssueResponse(BaseModel):
    """Validation issue for one user-provided skill package."""

    model_config = ConfigDict(extra="forbid")

    package: str
    error: str


class AgentSkillCatalogResponse(BaseModel):
    """Effective skills plus package issues and the catalog revision."""

    model_config = ConfigDict(extra="forbid")

    skills: list[AgentSkillCatalogItemResponse]
    issues: list[AgentSkillCatalogIssueResponse]
    catalog_revision: str


def configure_catalog_dependencies(
    *,
    skill_catalog: _CatalogProvider,
    tool_catalog: _CatalogProvider,
    assignment_store: _AssignmentProvider,
) -> None:
    """Bind historical catalog and assignment seams at the legacy facade."""
    global _skill_catalog_provider, _tool_catalog_provider, _assignment_provider
    _skill_catalog_provider = skill_catalog
    _tool_catalog_provider = tool_catalog
    _assignment_provider = assignment_store


def get_skill_catalog() -> Any:
    return _skill_catalog_provider()


def get_tool_catalog() -> Any:
    return _tool_catalog_provider()


def _assignment_store() -> Any:
    return _assignment_provider()


def _validate_automation_target(context: WorkspaceContext, *, agent_id: str, skill_id: str) -> None:
    assignments = _assignment_store()
    assignments.ensure_migrated()
    try:
        agent = assignments.get_agent(agent_id)
    except AgentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    normalized = skill_id.strip().lower()
    assigned = {str(value).strip().lower() for value in (agent.get("skill_ids") or [])}
    if normalized not in assigned:
        raise HTTPException(status_code=409, detail="skill is not assigned to agent")
    entry = get_skill_catalog().get_entry(normalized, Path(context.vault_path))
    if entry is None or not entry.available or entry.descriptor.kind != SkillKind.AGENT:
        raise HTTPException(status_code=409, detail="skill is unavailable for automation")


def _refresh_mcp_catalog(request: Request) -> None:
    from backend.services.mcp_tool_contributions import (
        refresh_mcp_tool_contributions,
    )

    refresh_mcp_tool_contributions(
        getattr(request.app.state, "tools_list", []) or [],
        getattr(request.app.state, "mcp_client", None),
    )


def _entry_response(entry: Any) -> Dict[str, Any]:
    result = dict(entry.descriptor.model_dump(mode="json"))
    result.update(
        {
            "available": entry.available,
            "missing_tool_ids": entry.missing_tool_ids,
            "effects": [
                effect.value if hasattr(effect, "value") else str(effect)
                for effect in entry.effects
            ],
            "editable": entry.editable,
            "deletable": entry.deletable,
            "revision": entry.revision,
        }
    )
    return result


def _validate_referenced_tools(tool_ids: List[str]) -> None:
    tools = {descriptor.id: descriptor for descriptor in get_tool_catalog().list()}
    missing = []
    unavailable = []
    for value in tool_ids:
        tool_id = str(value or "").strip().lower()
        descriptor = tools.get(tool_id)
        if descriptor is None:
            missing.append(tool_id)
        elif descriptor.status != CatalogStatus.AVAILABLE:
            unavailable.append(tool_id)
    if missing or unavailable:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "one or more tools are unavailable",
                "missing_tool_ids": missing,
                "unavailable_tool_ids": unavailable,
            },
        )


@router.get("/skills", response_model=AgentSkillCatalogResponse)
def list_skills(
    request: Request,
    context: WorkspaceContext = Depends(get_workspace_context),
) -> Any:
    """List the effective catalog and visible user-package validation issues."""

    _refresh_mcp_catalog(request)
    catalog = get_skill_catalog()
    try:
        entries = catalog.list_entries(Path(context.vault_path))
        _, issues = _store_for(context).load_all()
        return {
            "skills": [_entry_response(entry) for entry in entries],
            "issues": issues,
            "catalog_revision": catalog.revision(Path(context.vault_path)),
        }
    except (CatalogConflictError, CatalogProviderError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/skills/{skill_id}", response_model=None)
def get_skill(
    skill_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
) -> Any:
    entry = get_skill_catalog().get_entry(skill_id, Path(context.vault_path))
    if entry is None:
        raise HTTPException(status_code=404, detail="skill not found")
    return _entry_response(entry)


@router.post("/skills", status_code=201, response_model=None)
def create_skill(
    payload: UserSkillWritePayload,
    request: Request,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Any:
    _refresh_mcp_catalog(request)
    _validate_referenced_tools(payload.tool_ids)
    store = _store_for(context)
    try:
        descriptor = store.create(
            _metadata(payload),
            payload.instructions,
            requested_id=payload.requested_id,
        )
        entry = get_skill_catalog().get_entry(descriptor.id, Path(context.vault_path))
        return _entry_response(entry)
    except UserSkillConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except UserSkillStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/skills/{skill_id}", response_model=None)
def update_skill(
    skill_id: str,
    payload: UserSkillWritePayload,
    request: Request,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Any:
    if payload.requested_id and payload.requested_id != skill_id:
        raise HTTPException(status_code=400, detail="skill ID is immutable")
    _refresh_mcp_catalog(request)
    _validate_referenced_tools(payload.tool_ids)
    store = _store_for(context)
    try:
        descriptor = store.update(
            skill_id,
            _metadata(payload),
            payload.instructions,
            expected_revision=payload.expected_revision,
        )
        entry = get_skill_catalog().get_entry(descriptor.id, Path(context.vault_path))
        return _entry_response(entry)
    except UserSkillNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UserSkillConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except UserSkillStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/skills/{skill_id}/validate", response_model=None)
def validate_skill(
    skill_id: str,
    request: Request,
    payload: Optional[UserSkillWritePayload] = None,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Any:
    _refresh_mcp_catalog(request)
    store = _store_for(context)
    try:
        if payload is None:
            descriptor = store.load(skill_id)
        else:
            descriptor = store.validate(_metadata(payload), payload.instructions, skill_id=skill_id)
        tools = {descriptor.id: descriptor for descriptor in get_tool_catalog().list()}
        missing = [
            tool_id
            for tool_id in descriptor.tool_ids
            if tool_id not in tools or tools[tool_id].status != CatalogStatus.AVAILABLE
        ]
        return {
            "valid": not missing,
            "descriptor": descriptor.model_dump(mode="json"),
            "missing_tool_ids": missing,
        }
    except UserSkillNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UserSkillStoreError as exc:
        return {"valid": False, "errors": [str(exc)]}


@router.post("/skills/{skill_id}/clone", status_code=201, response_model=None)
def clone_skill(
    skill_id: str,
    request: Request,
    payload: Optional[CloneSkillPayload] = None,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Any:
    _refresh_mcp_catalog(request)
    entry = get_skill_catalog().get_entry(skill_id, Path(context.vault_path))
    if entry is None:
        raise HTTPException(status_code=404, detail="skill not found")
    descriptor = entry.descriptor
    clone_name = payload.name if payload and payload.name else f"{descriptor.name} copy"
    metadata = descriptor.model_dump(
        mode="python",
        exclude={"id", "origin", "instructions", "metadata"},
    )
    metadata["name"] = clone_name
    metadata["status"] = CatalogStatus.AVAILABLE
    try:
        clone = _store_for(context).create(metadata, descriptor.instructions)
        clone_entry = get_skill_catalog().get_entry(clone.id, Path(context.vault_path))
        return _entry_response(clone_entry)
    except UserSkillStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/skills/{skill_id}", response_model=None)
def delete_skill(
    skill_id: str,
    unassign: bool = Query(default=False),
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Any:
    store = _store_for(context)
    assignments = _assignment_store()
    assignments.ensure_migrated()
    try:
        store.load(skill_id)
    except UserSkillNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UserSkillStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    affected = assignments.list_agents_for_skill(skill_id)
    if affected and not unassign:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "skill is assigned to one or more agents",
                "affected_agents": affected,
                "requires_unassign": True,
            },
        )

    if not affected:
        store.delete(skill_id)
        return {"status": "deleted", "skill_id": skill_id, "affected_agents": []}

    staged = store.stage_delete(skill_id)
    try:
        unassigned = assignments.unassign_skill(skill_id)
    except Exception:
        store.rollback_delete(staged, skill_id)
        raise
    store.finalize_delete(staged)
    return {
        "status": "deleted",
        "skill_id": skill_id,
        "affected_agents": unassigned,
    }


@router.get("/tools", response_model=None)
def list_tools(
    request: Request,
    context: WorkspaceContext = Depends(get_workspace_context),
) -> Any:
    _refresh_mcp_catalog(request)
    catalog = get_skill_catalog()
    try:
        entries = catalog.list_entries(Path(context.vault_path))
        consumers: Dict[str, List[str]] = {}
        for entry in entries:
            for tool_id in entry.descriptor.tool_ids:
                consumers.setdefault(tool_id, []).append(entry.descriptor.id)
        tools = []
        tool_catalog = get_tool_catalog()
        for descriptor in tool_catalog.list():
            row = descriptor.model_dump(mode="json")
            row["skill_ids"] = consumers.get(descriptor.id, [])
            row["runtime_adapter_available"] = tool_catalog.get_handler(
                descriptor.id
            ) is not None or bool(descriptor.handler_ref)
            tools.append(row)
        return {
            "tools": tools,
            "catalog_revision": tool_catalog.revision,
        }
    except (CatalogConflictError, CatalogProviderError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/agents/{agent_id}/skills", response_model=None)
def get_agent_skills(
    agent_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
) -> Any:
    assignments = _assignment_store()
    assignments.ensure_migrated()
    try:
        agent = assignments.get_agent(agent_id)
    except AgentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {
        "agent_id": agent_id,
        "skill_ids": agent.get("skill_ids") or [],
        "required_skill_ids": agent.get("required_skill_ids") or [],
        "revision": assignments.agent_revision(agent_id),
    }


@router.put("/agents/{agent_id}/skills", response_model=None)
def assign_agent_skills(
    agent_id: str,
    payload: AgentSkillAssignmentPayload,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Any:
    assignments = _assignment_store()
    assignments.ensure_migrated()
    try:
        agent, revision = assignments.assign(
            agent_id,
            payload.skill_ids,
            catalog=get_skill_catalog(),
            vault_path=Path(context.vault_path),
            expected_revision=payload.expected_revision,
        )
        return {
            "agent_id": agent_id,
            "skill_ids": agent.get("skill_ids") or [],
            "required_skill_ids": agent.get("required_skill_ids") or [],
            "revision": revision,
        }
    except AgentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AgentAssignmentConflictError as exc:
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), **exc.details},
        ) from exc


@router.get(
    "/automations", dependencies=[Depends(require_plugins("automations"))], response_model=None
)
def list_skill_automations(
    context: WorkspaceContext = Depends(get_workspace_context),
) -> Any:
    """List automations visible in the exact workspace and vault scope."""
    return {"automations": list_automations(_automation_scope(context))}


@router.post(
    "/automations",
    status_code=201,
    dependencies=[Depends(require_plugins("automations"))],
    response_model=None,
)
def create_skill_automation(
    payload: AutomationWritePayload,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Any:
    _validate_automation_target(context, agent_id=payload.agent_id, skill_id=payload.skill_id)
    return save_automation(
        _automation_scope(context),
        vault_path=Path(context.vault_path),
        payload=payload.model_dump(exclude={"expected_revision"}),
    )


@router.get(
    "/automations/{automation_id}",
    dependencies=[Depends(require_plugins("automations"))],
    response_model=None,
)
def get_skill_automation(
    automation_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
) -> Any:
    try:
        return get_automation(automation_id, _automation_scope(context))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put(
    "/automations/{automation_id}",
    dependencies=[Depends(require_plugins("automations"))],
    response_model=None,
)
def update_skill_automation(
    automation_id: str,
    payload: AutomationWritePayload,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Any:
    _validate_automation_target(context, agent_id=payload.agent_id, skill_id=payload.skill_id)
    try:
        return save_automation(
            _automation_scope(context),
            vault_path=Path(context.vault_path),
            payload=payload.model_dump(exclude={"expected_revision"}),
            automation_id=automation_id,
            expected_revision=payload.expected_revision,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except AutomationConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete(
    "/automations/{automation_id}",
    dependencies=[Depends(require_plugins("automations"))],
    response_model=None,
)
def remove_skill_automation(
    automation_id: str,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Any:
    try:
        delete_automation(automation_id, _automation_scope(context))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "deleted", "automation_id": automation_id}


@router.get(
    "/automations/{automation_id}/runs",
    dependencies=[Depends(require_plugins("automations"))],
    response_model=None,
)
def list_skill_automation_runs(
    automation_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    context: WorkspaceContext = Depends(get_workspace_context),
) -> Any:
    try:
        return {"runs": list_runs(automation_id, _automation_scope(context), limit=limit)}
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post(
    "/automations/{automation_id}/run",
    status_code=202,
    dependencies=[Depends(require_plugins("automations"))],
    response_model=None,
)
def run_skill_automation_now(
    automation_id: str,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Any:
    try:
        get_automation(automation_id, _automation_scope(context))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    def _run() -> None:
        asyncio.run(run_automation(automation_id, manual=True))

    background_tasks.add_task(_run)
    return {"status": "queued", "automation_id": automation_id}

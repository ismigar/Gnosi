"""Settings APIs for governed agent skills and tools."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.config.app_config import load_params
from backend.models.agent_skills import (
    CatalogStatus,
    SkillActivation,
    SkillKind,
)
from backend.services.agent_skill_assignments import (
    AgentAssignmentConflictError,
    AgentNotFoundError,
    AgentSkillAssignmentStore,
)
from backend.services.agent_skill_catalog import (
    CatalogConflictError,
    CatalogProviderError,
    get_skill_catalog,
    get_tool_catalog,
)
from backend.services.user_skill_store import (
    UserSkillConflictError,
    UserSkillNotFoundError,
    UserSkillStore,
    UserSkillStoreError,
)
from backend.services.workspace_service import (
    WorkspaceContext,
    get_workspace_context,
    require_role,
)


router = APIRouter(prefix="/ai", tags=["AI Skills"])


class UserSkillWritePayload(BaseModel):
    """Editable fields of a user-owned declarative skill."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    version: str = Field(default="1.0.0", max_length=64)
    kind: SkillKind = SkillKind.AGENT
    activation: SkillActivation = SkillActivation.AUTOMATIC
    tool_ids: List[str] = Field(default_factory=list, max_length=64)
    instructions: str = Field(default="", max_length=100_000)
    requested_id: Optional[str] = None
    expected_revision: Optional[str] = None


class CloneSkillPayload(BaseModel):
    """Optional overrides when cloning an immutable catalog skill."""

    model_config = ConfigDict(extra="forbid")

    name: Optional[str] = Field(default=None, min_length=1, max_length=160)


class AgentSkillAssignmentPayload(BaseModel):
    """Revision-aware complete assignment list for one agent."""

    model_config = ConfigDict(extra="forbid")

    skill_ids: List[str] = Field(default_factory=list, max_length=128)
    expected_revision: Optional[str] = None


def _metadata(payload: UserSkillWritePayload) -> Dict[str, Any]:
    return {
        "schema_version": 1,
        "version": payload.version,
        "name": payload.name,
        "description": payload.description,
        "kind": payload.kind,
        "activation": payload.activation,
        "tool_ids": payload.tool_ids,
        "status": CatalogStatus.AVAILABLE,
    }


def _store_for(context: WorkspaceContext) -> UserSkillStore:
    return UserSkillStore(Path(context.vault_path))


def _assignment_store() -> AgentSkillAssignmentStore:
    # Apply the built-in plugin's idempotent profile migration before taking
    # the assignment snapshot. This repairs installations where the generic
    # legacy migration ran before the Brain skills became available.
    try:
        from backend.api.vault_routes import _llm_wiki_enabled, _load_plugins_state
        from backend.services.llm_wiki_agent import transition_agent

        if _llm_wiki_enabled(_load_plugins_state()):
            transition_agent(True)
    except Exception:
        # Assignment reads remain available even if an optional plugin cannot
        # reconcile. Missing/suspended references stay visible in the catalog.
        pass
    cfg = load_params(strict_env=False)
    return AgentSkillAssignmentStore(cfg.params_source, cfg.params)


def _refresh_mcp_catalog(request: Request) -> None:
    from backend.services.mcp_tool_contributions import (
        refresh_mcp_tool_contributions,
    )

    refresh_mcp_tool_contributions(
        getattr(request.app.state, "tools_list", []) or [],
        getattr(request.app.state, "mcp_client", None),
    )


def _entry_response(entry) -> Dict[str, Any]:
    result = entry.descriptor.model_dump(mode="json")
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


@router.get("/skills")
def list_skills(
    request: Request,
    context: WorkspaceContext = Depends(get_workspace_context),
):
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


@router.get("/skills/{skill_id}")
def get_skill(
    skill_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
):
    entry = get_skill_catalog().get_entry(skill_id, Path(context.vault_path))
    if entry is None:
        raise HTTPException(status_code=404, detail="skill not found")
    return _entry_response(entry)


@router.post("/skills", status_code=201)
def create_skill(
    payload: UserSkillWritePayload,
    request: Request,
    context: WorkspaceContext = Depends(require_role("admin")),
):
    _refresh_mcp_catalog(request)
    _validate_referenced_tools(payload.tool_ids)
    store = _store_for(context)
    try:
        descriptor = store.create(
            _metadata(payload),
            payload.instructions,
            requested_id=payload.requested_id,
        )
        entry = get_skill_catalog().get_entry(
            descriptor.id, Path(context.vault_path)
        )
        return _entry_response(entry)
    except UserSkillConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except UserSkillStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/skills/{skill_id}")
def update_skill(
    skill_id: str,
    payload: UserSkillWritePayload,
    request: Request,
    context: WorkspaceContext = Depends(require_role("admin")),
):
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
        entry = get_skill_catalog().get_entry(
            descriptor.id, Path(context.vault_path)
        )
        return _entry_response(entry)
    except UserSkillNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except UserSkillConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except UserSkillStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/skills/{skill_id}/validate")
def validate_skill(
    skill_id: str,
    request: Request,
    payload: Optional[UserSkillWritePayload] = None,
    context: WorkspaceContext = Depends(require_role("admin")),
):
    _refresh_mcp_catalog(request)
    store = _store_for(context)
    try:
        if payload is None:
            descriptor = store.load(skill_id)
        else:
            descriptor = store.validate(
                _metadata(payload), payload.instructions, skill_id=skill_id
            )
        tools = {
            descriptor.id: descriptor
            for descriptor in get_tool_catalog().list()
        }
        missing = [
            tool_id
            for tool_id in descriptor.tool_ids
            if tool_id not in tools
            or tools[tool_id].status != CatalogStatus.AVAILABLE
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


@router.post("/skills/{skill_id}/clone", status_code=201)
def clone_skill(
    skill_id: str,
    request: Request,
    payload: Optional[CloneSkillPayload] = None,
    context: WorkspaceContext = Depends(require_role("admin")),
):
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
        clone_entry = get_skill_catalog().get_entry(
            clone.id, Path(context.vault_path)
        )
        return _entry_response(clone_entry)
    except UserSkillStoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/skills/{skill_id}")
def delete_skill(
    skill_id: str,
    unassign: bool = Query(default=False),
    context: WorkspaceContext = Depends(require_role("admin")),
):
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


@router.get("/tools")
def list_tools(
    request: Request,
    context: WorkspaceContext = Depends(get_workspace_context),
):
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
            row["runtime_adapter_available"] = (
                tool_catalog.get_handler(descriptor.id) is not None
                or bool(descriptor.handler_ref)
            )
            tools.append(row)
        return {
            "tools": tools,
            "catalog_revision": tool_catalog.revision,
        }
    except (CatalogConflictError, CatalogProviderError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/agents/{agent_id}/skills")
def get_agent_skills(
    agent_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
):
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


@router.put("/agents/{agent_id}/skills")
def assign_agent_skills(
    agent_id: str,
    payload: AgentSkillAssignmentPayload,
    context: WorkspaceContext = Depends(require_role("admin")),
):
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

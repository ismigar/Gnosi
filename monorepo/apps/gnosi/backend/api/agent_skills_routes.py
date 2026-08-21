"""Settings APIs for governed agent skills and tools."""

from __future__ import annotations

import asyncio
import hashlib
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.agent.action_confirmations import list_workspace_confirmations
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
from backend.services.capability_automations import (
    AutomationConflictError,
    delete_automation,
    get_automation,
    list_automations,
    list_runs,
    run_automation,
    save_automation,
)
from backend.services.capability_audit import list_workspace_capability_events
from backend.services.agent_quality_telemetry import (
    list_evaluation_candidates,
    quality_dashboard,
    review_evaluation_candidate,
    reviewed_evaluation_cases,
)
from backend.services.agent_capability_health import list_capability_health
from backend.services.agent_semantic_memory import (
    add_association,
    delete_association,
    list_associations,
)
from backend.services.capability_jobs import (
    cancel_job as cancel_capability_job,
    get_job_status as get_capability_job_status,
    list_jobs as list_capability_jobs,
    read_job_result as read_capability_job_result,
    resume_job as resume_capability_job,
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


class AutomationWritePayload(BaseModel):
    """A recurring invocation of one explicitly assigned agent skill."""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=160)
    agent_id: str = Field(min_length=1, max_length=128)
    skill_id: str = Field(min_length=1, max_length=256)
    instruction: str = Field(min_length=1, max_length=12_000)
    interval_minutes: int = Field(default=1_440, ge=5, le=525_600)
    enabled: bool = False
    max_runs_per_day: int = Field(default=4, ge=1, le=144)
    max_ai_calls_per_run: int = Field(default=4, ge=1, le=16)
    max_runtime_seconds: int = Field(default=180, ge=15, le=900)
    expected_revision: Optional[str] = None


class EvaluationCandidateReviewPayload(BaseModel):
    """Administrative decision for one privacy-safe evaluation candidate."""

    decision: str = Field(pattern=r"^(pending_review|accepted|rejected)$")


class PersonalMemoryPayload(BaseModel):
    """Explicit user-owned memory fields."""

    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=4_000)
    category: str = Field(default="preference", max_length=48)
    provenance: str = Field(default="user", max_length=96)
    expires_at: Optional[str] = Field(default=None, max_length=40)
    enabled: bool = True
    expected_revision: Optional[int] = Field(default=None, ge=1)


class SemanticAssociationPayload(BaseModel):
    """One explicit, reversible personal vocabulary correction."""

    model_config = ConfigDict(extra="forbid")

    trigger: str = Field(min_length=1, max_length=96)
    related_terms: List[str] = Field(min_length=1, max_length=24)


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


def _automation_scope(context: WorkspaceContext) -> Dict[str, str]:
    vault = Path(context.vault_path).resolve()
    return {
        "vault_scope": hashlib.sha256(str(vault).encode("utf-8")).hexdigest()[:20],
        "workspace_id": context.workspace_id,
        "user_id": context.user_id,
        "role": context.role,
    }


def _require_configured_agent(agent_id: str) -> dict[str, Any]:
    ai = dict(load_params(strict_env=False).get("ai", {}) or {})
    agent = next(
        (
            item for item in (ai.get("agents") or [])
            if isinstance(item, dict) and str(item.get("id")) == str(agent_id)
        ),
        None,
    )
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")
    return agent


@router.get("/jobs")
def list_governed_jobs(
    context: WorkspaceContext = Depends(get_workspace_context),
):
    """List namespaced durable capability jobs for the active Vault."""
    return {"jobs": list_capability_jobs(Path(context.vault_path))}


@router.get("/jobs/{job_id}")
def get_governed_job(
    job_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
):
    """Read one durable job's current provider-neutral status."""
    try:
        return get_capability_job_status(Path(context.vault_path), job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Capability job not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/jobs/{job_id}/result")
def get_governed_job_result(
    job_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
):
    """Read the durable result when the owning provider exposes it."""
    try:
        return read_capability_job_result(Path(context.vault_path), job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Capability job not found.") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/resume")
def resume_governed_job(
    job_id: str,
    context: WorkspaceContext = Depends(require_role("editor")),
):
    """Resume a provider-owned failed or interrupted durable job."""
    try:
        return resume_capability_job(Path(context.vault_path), job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Capability job not found.") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/cancel")
def cancel_governed_job(
    job_id: str,
    context: WorkspaceContext = Depends(require_role("editor")),
):
    """Request cooperative cancellation of a cancellable durable job."""
    try:
        return cancel_capability_job(Path(context.vault_path), job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Capability job not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/capability-audit")
def list_workspace_capability_audit(
    limit: int = Query(default=200, ge=1, le=500),
    context: WorkspaceContext = Depends(require_role("admin")),
):
    """List current-user metadata-only tool events across agents and sessions."""
    return {
        "events": list_workspace_capability_events(
            _automation_scope(context), limit=limit
        )
    }


@router.get("/evals/candidates")
def list_agent_evaluation_candidates(
    limit: int = Query(default=200, ge=1, le=500),
    context: WorkspaceContext = Depends(require_role("admin")),
):
    """List deduplicated metadata-only regression candidates."""
    return {
        "candidates": list_evaluation_candidates(
            _automation_scope(context), limit=limit
        )
    }


@router.get("/quality/dashboard")
def get_agent_quality_dashboard(
    context: WorkspaceContext = Depends(require_role("admin")),
):
    """Return privacy-safe agent service levels and persisted tool health."""
    return {
        "quality": quality_dashboard(_automation_scope(context)),
        "capabilities": list_capability_health(limit=200),
    }


@router.get("/quality/conformance")
def get_agent_capability_conformance(
    context: WorkspaceContext = Depends(require_role("admin")),
):
    """Report versioned skill/tool contract coverage without granting access."""
    from backend.services.agent_capability_conformance import conformance_report

    report = conformance_report(
        get_tool_catalog().list(),
        get_skill_catalog().list_entries(Path(context.vault_path)),
    )
    from backend.services.durable_job_worker import dispatcher_contracts

    report["durable_job_dispatchers"] = dispatcher_contracts()
    return report


@router.get("/semantic-associations")
def get_agent_semantic_associations(
    limit: int = Query(default=200, ge=1, le=500),
    context: WorkspaceContext = Depends(get_workspace_context),
):
    """List reviewable vocabulary associations for the active Vault."""
    return {"associations": list_associations(context.vault_path, limit=limit)}


@router.post("/semantic-associations", status_code=201)
def create_agent_semantic_association(
    payload: SemanticAssociationPayload,
    context: WorkspaceContext = Depends(require_role("editor")),
):
    """Store an explicit term correction without conversation content."""
    try:
        rows = add_association(
            context.vault_path,
            payload.trigger,
            payload.related_terms,
            created_by=context.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"associations": rows}


@router.delete("/semantic-associations/{association_id}")
def remove_agent_semantic_association(
    association_id: str,
    context: WorkspaceContext = Depends(require_role("editor")),
):
    """Remove one exact vocabulary correction from the active Vault."""
    if not delete_association(context.vault_path, association_id):
        raise HTTPException(status_code=404, detail="Semantic association not found.")
    return {"status": "deleted", "association_id": association_id}


@router.get("/agents/{agent_id}/memories")
def get_agent_memories(
    agent_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
):
    from backend.services.agent_personal_memory import list_memories

    _require_configured_agent(agent_id)
    return {"memories": list_memories(
        context.vault_path, agent_id, user_id=context.user_id,
    )}


@router.post("/agents/{agent_id}/memories", status_code=201)
def create_agent_memory(
    agent_id: str,
    payload: PersonalMemoryPayload,
    context: WorkspaceContext = Depends(require_role("editor")),
):
    from backend.services.agent_personal_memory import create_memory

    _require_configured_agent(agent_id)
    try:
        return create_memory(
            context.vault_path, agent_id, payload.text,
            category=payload.category, provenance=payload.provenance,
            expires_at=payload.expires_at, user_id=context.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/agents/{agent_id}/memories/{memory_id}")
def edit_agent_memory(
    agent_id: str,
    memory_id: str,
    payload: PersonalMemoryPayload,
    context: WorkspaceContext = Depends(require_role("editor")),
):
    from backend.services.agent_personal_memory import update_memory

    _require_configured_agent(agent_id)
    if payload.expected_revision is None:
        raise HTTPException(status_code=400, detail="expected_revision is required")
    try:
        return update_memory(
            context.vault_path, agent_id, memory_id,
            text=payload.text, category=payload.category, enabled=payload.enabled,
            expires_at=payload.expires_at, expected_revision=payload.expected_revision,
            user_id=context.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/agents/{agent_id}/memories/{memory_id}")
def remove_agent_memory(
    agent_id: str,
    memory_id: str,
    context: WorkspaceContext = Depends(require_role("editor")),
):
    from backend.services.agent_personal_memory import delete_memory

    _require_configured_agent(agent_id)
    if not delete_memory(
        context.vault_path, agent_id, memory_id, user_id=context.user_id,
    ):
        raise HTTPException(status_code=404, detail="Memory not found.")
    return {"status": "deleted", "memory_id": memory_id}


@router.get("/evals/models")
def get_model_evaluations(
    limit: int = Query(default=50, ge=1, le=200),
    context: WorkspaceContext = Depends(require_role("admin")),
):
    from backend.services.agent_model_evaluations import list_evaluations

    return {"evaluations": list_evaluations(limit)}


@router.post("/evals/models/{agent_id}/run")
async def run_agent_model_evaluation(
    agent_id: str,
    context: WorkspaceContext = Depends(require_role("admin")),
):
    """Run explicit synthetic model calls and persist metadata-only scores."""
    from langchain_core.messages import HumanMessage
    from backend.agent.factory import get_llm
    from backend.security.ai_credentials import resolve_provider_api_key
    from backend.services.agent_model_evaluations import evaluate_with_invoker

    ai = dict(load_params(strict_env=False).get("ai", {}) or {})
    agent = _require_configured_agent(agent_id)
    provider = str(agent.get("provider") or "")
    model = str(agent.get("model") or "")
    provider_config = dict((ai.get("providers") or {}).get(provider) or {})
    llm = get_llm(
        provider=provider, model=model,
        api_key=resolve_provider_api_key(provider, provider_config),
        base_url=provider_config.get("base_url"), timeout=45,
    )
    if llm is None:
        raise HTTPException(status_code=409, detail="Agent model is unavailable.")
    return await asyncio.to_thread(
        evaluate_with_invoker,
        provider,
        model,
        agent_id,
        lambda prompt: llm.invoke([HumanMessage(content=prompt)]),
    )


@router.post("/evals/candidates/{candidate_id}/review")
def review_agent_evaluation_candidate(
    candidate_id: str,
    payload: EvaluationCandidateReviewPayload,
    context: WorkspaceContext = Depends(require_role("admin")),
):
    """Accept, reject, or reopen one synthetic evaluation case."""
    try:
        return review_evaluation_candidate(
            _automation_scope(context), candidate_id, payload.decision
        )
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail="Evaluation candidate not found."
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/evals/candidates/run")
def run_reviewed_agent_evaluation_candidates(
    context: WorkspaceContext = Depends(require_role("admin")),
):
    """Run accepted synthetic cases without constructing a model."""
    from backend.agent.evals.runner import run_evaluations

    cases = reviewed_evaluation_cases(_automation_scope(context))
    if not cases:
        return {
            "schema_version": 1,
            "suite": "reviewed-agent-quality-candidates",
            "passed": 0,
            "total": 0,
            "score": 1.0,
            "results": [],
        }
    report = run_evaluations(cases)
    report["suite"] = "reviewed-agent-quality-candidates"
    return report


@router.get("/approvals")
def list_workspace_approvals(
    context: WorkspaceContext = Depends(require_role("admin")),
):
    """List pending automation approvals without exposing stored arguments."""
    return {
        "approvals": list_workspace_confirmations(_automation_scope(context))
    }


def _validate_automation_target(
    context: WorkspaceContext, *, agent_id: str, skill_id: str
) -> None:
    assignments = _assignment_store()
    assignments.ensure_migrated()
    try:
        agent = assignments.get_agent(agent_id)
    except AgentNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    normalized = skill_id.strip().lower()
    assigned = {
        str(value).strip().lower() for value in (agent.get("skill_ids") or [])
    }
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


@router.get("/automations")
def list_skill_automations(
    context: WorkspaceContext = Depends(get_workspace_context),
):
    """List automations visible in the exact workspace and vault scope."""
    return {"automations": list_automations(_automation_scope(context))}


@router.post("/automations", status_code=201)
def create_skill_automation(
    payload: AutomationWritePayload,
    context: WorkspaceContext = Depends(require_role("admin")),
):
    _validate_automation_target(
        context, agent_id=payload.agent_id, skill_id=payload.skill_id
    )
    return save_automation(
        _automation_scope(context),
        vault_path=Path(context.vault_path),
        payload=payload.model_dump(exclude={"expected_revision"}),
    )


@router.get("/automations/{automation_id}")
def get_skill_automation(
    automation_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
):
    try:
        return get_automation(automation_id, _automation_scope(context))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.put("/automations/{automation_id}")
def update_skill_automation(
    automation_id: str,
    payload: AutomationWritePayload,
    context: WorkspaceContext = Depends(require_role("admin")),
):
    _validate_automation_target(
        context, agent_id=payload.agent_id, skill_id=payload.skill_id
    )
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


@router.delete("/automations/{automation_id}")
def remove_skill_automation(
    automation_id: str,
    context: WorkspaceContext = Depends(require_role("admin")),
):
    try:
        delete_automation(automation_id, _automation_scope(context))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "deleted", "automation_id": automation_id}


@router.get("/automations/{automation_id}/runs")
def list_skill_automation_runs(
    automation_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    context: WorkspaceContext = Depends(get_workspace_context),
):
    try:
        return {
            "runs": list_runs(
                automation_id, _automation_scope(context), limit=limit
            )
        }
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/automations/{automation_id}/run", status_code=202)
def run_skill_automation_now(
    automation_id: str,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext = Depends(require_role("admin")),
):
    try:
        get_automation(automation_id, _automation_scope(context))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    def _run() -> None:
        asyncio.run(run_automation(automation_id, manual=True))

    background_tasks.add_task(_run)
    return {"status": "queued", "automation_id": automation_id}

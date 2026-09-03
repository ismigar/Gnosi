"""Governance and quality routes for agent capabilities."""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Callable, Mapping
from pathlib import Path

from fastapi import Depends, HTTPException, Query

from backend.agent.action_confirmations import list_workspace_confirmations
from backend.config.app_config import load_params
from backend.domains.configuration.agent.contracts import (
    EvaluationCandidateReviewPayload,
    PersonalMemoryPayload,
    SemanticAssociationPayload,
    UserSkillWritePayload,
)
from backend.domains.configuration.agent.governance_models import (
    AgentQualityDashboardResponse,
    AutomationApprovalsResponse,
    CapabilityAuditResponse,
    CapabilityConformanceResponse,
    CapabilityJobResponse,
    CapabilityJobResultResponse,
    CapabilityJobsResponse,
    EvaluationCandidateResponse,
    EvaluationCandidatesResponse,
    ModelEvaluationResponse,
    ModelEvaluationsResponse,
    PersonalMemoriesResponse,
    PersonalMemoryDeleteResponse,
    PersonalMemoryResponse,
    ReviewedEvaluationReportResponse,
    SemanticAssociationDeleteResponse,
    SemanticAssociationsResponse,
)
from backend.domains.configuration.agent.router import router
from backend.models.agent_skills import CatalogStatus
from backend.services.agent_capability_health import list_capability_health
from backend.services.agent_quality_telemetry import (
    list_evaluation_candidates,
    quality_dashboard,
    review_evaluation_candidate,
    reviewed_evaluation_cases,
)
from backend.services.agent_semantic_memory import (
    add_association,
    delete_association,
    list_associations,
)
from backend.services.agent_skill_assignments import AgentSkillAssignmentStore
from backend.services.agent_skill_catalog import (
    SkillCatalog,
    ToolCatalog,
    get_skill_catalog as _default_get_skill_catalog,
)
from backend.services.agent_skill_catalog import (
    get_tool_catalog as _default_get_tool_catalog,
)
from backend.services.capability_audit import list_workspace_capability_events
from backend.services.capability_jobs import (
    cancel_job as _default_cancel_capability_job,
)
from backend.services.capability_jobs import (
    get_job_status as _default_get_capability_job_status,
)
from backend.services.capability_jobs import (
    list_jobs as list_capability_jobs,
)
from backend.services.capability_jobs import (
    read_job_result as _default_read_capability_job_result,
)
from backend.services.capability_jobs import (
    resume_job as _default_resume_capability_job,
)
from backend.services.user_skill_store import UserSkillStore
from backend.services.workspace_service import (
    WorkspaceContext,
    get_workspace_context,
    require_role,
)
from backend.utils.open_values import iterate_values

_JobOperation = Callable[[Path, str], Mapping[str, object]]
_SkillCatalogProvider = Callable[[], SkillCatalog]
_ToolCatalogProvider = Callable[[], ToolCatalog]
_get_job_status: _JobOperation = _default_get_capability_job_status
_read_job_result: _JobOperation = _default_read_capability_job_result
_cancel_job: _JobOperation = _default_cancel_capability_job
_resume_job: _JobOperation = _default_resume_capability_job
_skill_catalog_provider: _SkillCatalogProvider = _default_get_skill_catalog
_tool_catalog_provider: _ToolCatalogProvider = _default_get_tool_catalog


def configure_job_dependencies(
    *,
    get_status: _JobOperation,
    read_result: _JobOperation,
    cancel: _JobOperation,
    resume: _JobOperation,
    skill_catalog: _SkillCatalogProvider,
    tool_catalog: _ToolCatalogProvider,
) -> None:
    """Bind historical monkeypatch seams at the compatibility edge."""
    global _get_job_status, _read_job_result, _cancel_job, _resume_job
    global _skill_catalog_provider, _tool_catalog_provider
    _get_job_status = get_status
    _read_job_result = read_result
    _cancel_job = cancel
    _resume_job = resume
    _skill_catalog_provider = skill_catalog
    _tool_catalog_provider = tool_catalog


def _metadata(payload: UserSkillWritePayload) -> dict[str, object]:
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


def _automation_scope(context: WorkspaceContext) -> dict[str, str]:
    vault = Path(context.vault_path).resolve()
    return {
        "vault_scope": hashlib.sha256(str(vault).encode("utf-8")).hexdigest()[:20],
        "workspace_id": context.workspace_id,
        "user_id": context.user_id,
        "role": context.role,
    }


def _ai_configuration() -> dict[str, object]:
    raw_ai: object = load_params(strict_env=False).ai
    if not isinstance(raw_ai, Mapping):
        return {}
    return {str(key): value for key, value in raw_ai.items()}


def _require_configured_agent(agent_id: str) -> dict[str, object]:
    ai = _ai_configuration()
    for item in iterate_values(ai.get("agents") or []):
        if isinstance(item, Mapping) and str(item.get("id")) == str(agent_id):
            return {str(key): value for key, value in item.items()}
    raise HTTPException(status_code=404, detail="Agent not found.")


@router.get(
    "/jobs",
    response_model=CapabilityJobsResponse,
    response_model_exclude_unset=True,
)
def list_governed_jobs(
    context: WorkspaceContext = Depends(get_workspace_context),
) -> dict[str, object]:
    """List namespaced durable capability jobs for the active Vault."""
    return {"jobs": list_capability_jobs(Path(context.vault_path))}


@router.get(
    "/jobs/{job_id}",
    response_model=CapabilityJobResponse,
    response_model_exclude_unset=True,
)
def get_governed_job(
    job_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
) -> Mapping[str, object]:
    """Read one durable job's current provider-neutral status."""
    try:
        return _get_job_status(Path(context.vault_path), job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Capability job not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/jobs/{job_id}/result",
    response_model=CapabilityJobResultResponse,
    response_model_exclude_unset=True,
)
def get_governed_job_result(
    job_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
) -> Mapping[str, object]:
    """Read the durable result when the owning provider exposes it."""
    try:
        return _read_job_result(Path(context.vault_path), job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Capability job not found.") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post(
    "/jobs/{job_id}/resume",
    response_model=CapabilityJobResponse,
    response_model_exclude_unset=True,
)
def resume_governed_job(
    job_id: str,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> Mapping[str, object]:
    """Resume a provider-owned failed or interrupted durable job."""
    try:
        return _resume_job(Path(context.vault_path), job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Capability job not found.") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post(
    "/jobs/{job_id}/cancel",
    response_model=CapabilityJobResponse,
    response_model_exclude_unset=True,
)
def cancel_governed_job(
    job_id: str,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> Mapping[str, object]:
    """Request cooperative cancellation of a cancellable durable job."""
    try:
        return _cancel_job(Path(context.vault_path), job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Capability job not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get(
    "/capability-audit",
    response_model=CapabilityAuditResponse,
    response_model_exclude_unset=True,
)
def list_workspace_capability_audit(
    limit: int = Query(default=200, ge=1, le=500),
    context: WorkspaceContext = Depends(require_role("admin")),
) -> dict[str, object]:
    """List current-user metadata-only tool events across agents and sessions."""
    return {"events": list_workspace_capability_events(_automation_scope(context), limit=limit)}


@router.get(
    "/evals/candidates",
    response_model=EvaluationCandidatesResponse,
    response_model_exclude_unset=True,
)
def list_agent_evaluation_candidates(
    limit: int = Query(default=200, ge=1, le=500),
    context: WorkspaceContext = Depends(require_role("admin")),
) -> dict[str, object]:
    """List deduplicated metadata-only regression candidates."""
    return {"candidates": list_evaluation_candidates(_automation_scope(context), limit=limit)}


@router.get(
    "/quality/dashboard",
    response_model=AgentQualityDashboardResponse,
    response_model_exclude_unset=True,
)
def get_agent_quality_dashboard(
    context: WorkspaceContext = Depends(require_role("admin")),
) -> dict[str, object]:
    """Return privacy-safe agent service levels and persisted tool health."""
    return {
        "quality": quality_dashboard(_automation_scope(context)),
        "capabilities": list_capability_health(limit=200),
    }


@router.get(
    "/quality/conformance",
    response_model=CapabilityConformanceResponse,
    response_model_exclude_unset=True,
)
def get_agent_capability_conformance(
    context: WorkspaceContext = Depends(require_role("admin")),
) -> dict[str, object]:
    """Report versioned skill/tool contract coverage without granting access."""
    from backend.services.agent_capability_conformance import conformance_report

    report = conformance_report(
        _tool_catalog_provider().list(),
        _skill_catalog_provider().list_entries(Path(context.vault_path)),
    )
    from backend.services.durable_job_worker import dispatcher_contracts

    report["durable_job_dispatchers"] = dispatcher_contracts()
    return report


@router.get(
    "/semantic-associations",
    response_model=SemanticAssociationsResponse,
    response_model_exclude_unset=True,
)
def get_agent_semantic_associations(
    limit: int = Query(default=200, ge=1, le=500),
    context: WorkspaceContext = Depends(get_workspace_context),
) -> dict[str, object]:
    """List reviewable vocabulary associations for the active Vault."""
    return {"associations": list_associations(context.vault_path, limit=limit)}


@router.post(
    "/semantic-associations",
    status_code=201,
    response_model=SemanticAssociationsResponse,
    response_model_exclude_unset=True,
)
def create_agent_semantic_association(
    payload: SemanticAssociationPayload,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> dict[str, object]:
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


@router.delete(
    "/semantic-associations/{association_id}",
    response_model=SemanticAssociationDeleteResponse,
    response_model_exclude_unset=True,
)
def remove_agent_semantic_association(
    association_id: str,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> dict[str, str]:
    """Remove one exact vocabulary correction from the active Vault."""
    if not delete_association(context.vault_path, association_id):
        raise HTTPException(status_code=404, detail="Semantic association not found.")
    return {"status": "deleted", "association_id": association_id}


@router.get(
    "/agents/{agent_id}/memories",
    response_model=PersonalMemoriesResponse,
    response_model_exclude_unset=True,
)
def get_agent_memories(
    agent_id: str,
    context: WorkspaceContext = Depends(get_workspace_context),
) -> dict[str, object]:
    from backend.services.agent_personal_memory import list_memories

    _require_configured_agent(agent_id)
    return {
        "memories": list_memories(
            context.vault_path,
            agent_id,
            user_id=context.user_id,
        )
    }


@router.post(
    "/agents/{agent_id}/memories",
    status_code=201,
    response_model=PersonalMemoryResponse,
    response_model_exclude_unset=True,
)
def create_agent_memory(
    agent_id: str,
    payload: PersonalMemoryPayload,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> Mapping[str, object]:
    from backend.services.agent_personal_memory import create_memory

    _require_configured_agent(agent_id)
    try:
        return create_memory(
            context.vault_path,
            agent_id,
            payload.text,
            category=payload.category,
            provenance=payload.provenance,
            expires_at=payload.expires_at,
            user_id=context.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put(
    "/agents/{agent_id}/memories/{memory_id}",
    response_model=PersonalMemoryResponse,
    response_model_exclude_unset=True,
)
def edit_agent_memory(
    agent_id: str,
    memory_id: str,
    payload: PersonalMemoryPayload,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> Mapping[str, object]:
    from backend.services.agent_personal_memory import update_memory

    _require_configured_agent(agent_id)
    if payload.expected_revision is None:
        raise HTTPException(status_code=400, detail="expected_revision is required")
    try:
        return update_memory(
            context.vault_path,
            agent_id,
            memory_id,
            text=payload.text,
            category=payload.category,
            enabled=payload.enabled,
            expires_at=payload.expires_at,
            expected_revision=payload.expected_revision,
            user_id=context.user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete(
    "/agents/{agent_id}/memories/{memory_id}",
    response_model=PersonalMemoryDeleteResponse,
    response_model_exclude_unset=True,
)
def remove_agent_memory(
    agent_id: str,
    memory_id: str,
    context: WorkspaceContext = Depends(require_role("editor")),
) -> dict[str, str]:
    from backend.services.agent_personal_memory import delete_memory

    _require_configured_agent(agent_id)
    if not delete_memory(
        context.vault_path,
        agent_id,
        memory_id,
        user_id=context.user_id,
    ):
        raise HTTPException(status_code=404, detail="Memory not found.")
    return {"status": "deleted", "memory_id": memory_id}


@router.get(
    "/evals/models",
    response_model=ModelEvaluationsResponse,
    response_model_exclude_unset=True,
)
def get_model_evaluations(
    limit: int = Query(default=50, ge=1, le=200),
    context: WorkspaceContext = Depends(require_role("admin")),
) -> dict[str, object]:
    from backend.services.agent_model_evaluations import list_evaluations

    return {"evaluations": list_evaluations(limit)}


@router.post(
    "/evals/models/{agent_id}/run",
    response_model=ModelEvaluationResponse,
    response_model_exclude_unset=True,
)
async def run_agent_model_evaluation(
    agent_id: str,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Mapping[str, object]:
    """Run explicit synthetic model calls and persist metadata-only scores."""
    from langchain_core.messages import HumanMessage

    from backend.agent.factory import get_llm
    from backend.security.ai_credentials import resolve_provider_api_key
    from backend.services.agent_model_evaluations import evaluate_with_invoker

    ai = _ai_configuration()
    agent = _require_configured_agent(agent_id)
    provider = str(agent.get("provider") or "")
    model = str(agent.get("model") or "")
    raw_providers = ai.get("providers")
    providers = raw_providers if isinstance(raw_providers, Mapping) else {}
    raw_provider_config = providers.get(provider)
    provider_config = (
        {str(key): value for key, value in raw_provider_config.items()}
        if isinstance(raw_provider_config, Mapping)
        else {}
    )
    raw_base_url = provider_config.get("base_url")
    base_url = raw_base_url if isinstance(raw_base_url, str) else None
    llm = get_llm(
        provider=provider,
        model=model,
        api_key=resolve_provider_api_key(provider, provider_config),
        base_url=base_url,
        timeout=45,
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


@router.post(
    "/evals/candidates/{candidate_id}/review",
    response_model=EvaluationCandidateResponse,
    response_model_exclude_unset=True,
)
def review_agent_evaluation_candidate(
    candidate_id: str,
    payload: EvaluationCandidateReviewPayload,
    context: WorkspaceContext = Depends(require_role("admin")),
) -> Mapping[str, object]:
    """Accept, reject, or reopen one synthetic evaluation case."""
    try:
        return review_evaluation_candidate(
            _automation_scope(context), candidate_id, payload.decision
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Evaluation candidate not found.") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/evals/candidates/run",
    response_model=ReviewedEvaluationReportResponse,
    response_model_exclude_unset=True,
)
def run_reviewed_agent_evaluation_candidates(
    context: WorkspaceContext = Depends(require_role("admin")),
) -> dict[str, object]:
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


@router.get(
    "/approvals",
    response_model=AutomationApprovalsResponse,
    response_model_exclude_unset=True,
)
def list_workspace_approvals(
    context: WorkspaceContext = Depends(require_role("admin")),
) -> dict[str, object]:
    """List pending automation approvals without exposing stored arguments."""
    return {"approvals": list_workspace_confirmations(_automation_scope(context))}

"""Typed OpenAPI and legacy serialization contracts for agent governance."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from pydantic import BaseModel

from backend.api import agent_skills_routes
from backend.domains.configuration.agent import (
    catalog_models,
    catalog_routes,
    governance_models,
    governance_routes,
)
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


EXPECTED_MODELS: dict[str, type[object]] = {
    "cancel_governed_job": governance_models.CapabilityJobResponse,
    "create_agent_memory": governance_models.PersonalMemoryResponse,
    "create_agent_semantic_association": governance_models.SemanticAssociationsResponse,
    "edit_agent_memory": governance_models.PersonalMemoryResponse,
    "get_agent_capability_conformance": governance_models.CapabilityConformanceResponse,
    "get_agent_memories": governance_models.PersonalMemoriesResponse,
    "get_agent_quality_dashboard": governance_models.AgentQualityDashboardResponse,
    "get_agent_semantic_associations": governance_models.SemanticAssociationsResponse,
    "get_governed_job": governance_models.CapabilityJobResponse,
    "get_governed_job_result": governance_models.CapabilityJobResultResponse,
    "get_model_evaluations": governance_models.ModelEvaluationsResponse,
    "list_agent_evaluation_candidates": governance_models.EvaluationCandidatesResponse,
    "list_governed_jobs": governance_models.CapabilityJobsResponse,
    "list_workspace_approvals": governance_models.AutomationApprovalsResponse,
    "list_workspace_capability_audit": governance_models.CapabilityAuditResponse,
    "remove_agent_memory": governance_models.PersonalMemoryDeleteResponse,
    "remove_agent_semantic_association": governance_models.SemanticAssociationDeleteResponse,
    "resume_governed_job": governance_models.CapabilityJobResponse,
    "review_agent_evaluation_candidate": governance_models.EvaluationCandidateResponse,
    "run_agent_model_evaluation": governance_models.ModelEvaluationResponse,
    "run_reviewed_agent_evaluation_candidates": governance_models.ReviewedEvaluationReportResponse,
}

EXPECTED_CATALOG_MODELS: dict[str, object] = {
    "assign_agent_skills": catalog_models.AgentSkillAssignmentResponse,
    "clone_skill": catalog_models.AgentSkillCatalogItemResponse,
    "create_skill": catalog_models.AgentSkillCatalogItemResponse,
    "create_skill_automation": catalog_models.SkillAutomationResponse,
    "delete_skill": catalog_models.AgentSkillDeleteResponse,
    "get_agent_skills": catalog_models.AgentSkillAssignmentResponse,
    "get_skill": catalog_models.AgentSkillCatalogItemResponse,
    "get_skill_automation": catalog_models.SkillAutomationResponse,
    "list_skill_automation_runs": catalog_models.SkillAutomationRunsResponse,
    "list_skill_automations": catalog_models.SkillAutomationsResponse,
    "list_skills": catalog_models.AgentSkillCatalogResponse,
    "list_tools": catalog_models.AgentToolCatalogResponse,
    "remove_skill_automation": catalog_models.SkillAutomationDeleteResponse,
    "run_skill_automation_now": catalog_models.SkillAutomationQueuedResponse,
    "update_skill": catalog_models.AgentSkillCatalogItemResponse,
    "update_skill_automation": catalog_models.SkillAutomationResponse,
    "validate_skill": catalog_models.AgentSkillValidationResponse,
}


def _governance_routes() -> list[APIRoute]:
    return [
        route
        for route in agent_skills_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__module__ == governance_routes.__name__
    ]


def _catalog_routes() -> list[APIRoute]:
    return [
        route
        for route in agent_skills_routes.router.routes
        if isinstance(route, APIRoute) and route.endpoint.__module__ == catalog_routes.__name__
    ]


def test_every_governance_json_route_has_an_explicit_response_model() -> None:
    routes = _governance_routes()
    assert len(routes) == len(EXPECTED_MODELS)
    for route in routes:
        assert route.response_model is EXPECTED_MODELS[route.endpoint.__name__]
        assert route.response_model_exclude_unset is True

    statuses = {route.endpoint.__name__: route.status_code for route in routes}
    assert statuses["create_agent_memory"] == 201
    assert statuses["create_agent_semantic_association"] == 201
    assert all(
        value is None
        for name, value in statuses.items()
        if name not in {"create_agent_memory", "create_agent_semantic_association"}
    )


def test_every_catalog_json_route_has_an_explicit_response_model() -> None:
    routes = _catalog_routes()
    assert len(routes) == len(EXPECTED_CATALOG_MODELS)
    for route in routes:
        assert route.response_model == EXPECTED_CATALOG_MODELS[route.endpoint.__name__]
        assert route.response_model_exclude_unset is True

    statuses = {route.endpoint.__name__: route.status_code for route in routes}
    assert statuses["create_skill"] == 201
    assert statuses["clone_skill"] == 201
    assert statuses["create_skill_automation"] == 201
    assert statuses["run_skill_automation_now"] == 202
    assert all(
        value is None
        for name, value in statuses.items()
        if name
        not in {
            "create_skill",
            "clone_skill",
            "create_skill_automation",
            "run_skill_automation_now",
        }
    )


def test_agent_configuration_domain_has_no_untyped_json_route() -> None:
    routes = [*_governance_routes(), *_catalog_routes()]
    assert len(routes) == 38
    assert all(route.response_model is not None for route in routes)


def test_governance_openapi_exposes_structured_success_schemas() -> None:
    app = FastAPI()
    app.include_router(agent_skills_routes.router, prefix="/api")
    schema = app.openapi()

    for route in [*_governance_routes(), *_catalog_routes()]:
        method = next(iter(route.methods or set())).lower()
        status = str(route.status_code or 200)
        response_schema = schema["paths"][f"/api{route.path}"][method]["responses"][status][
            "content"
        ]["application/json"]["schema"]
        assert response_schema != {}
        assert any(key in response_schema for key in ("$ref", "anyOf", "oneOf"))


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (
            catalog_models.AgentSkillValidationErrorResponse,
            {"valid": False, "errors": ["legacy package error"]},
        ),
        (
            catalog_models.AgentSkillAssignmentResponse,
            {
                "agent_id": "legacy-agent",
                "skill_ids": "core.legacy-default-v1",
                "required_skill_ids": [],
                "revision": "legacy-revision",
                "legacy_mode": True,
            },
        ),
        (
            catalog_models.SkillAutomationResponse,
            {
                "id": "a" * 32,
                "name": "Fixture",
                "agent_id": "assistant",
                "skill_id": "core.fixture",
                "instruction": "Run fixture",
                "interval_minutes": 60,
                "enabled": True,
                "budgets": {
                    "max_runs_per_day": 2,
                    "max_ai_calls_per_run": 3,
                    "max_runtime_seconds": 60,
                },
                "next_run_at": None,
                "last_run_at": None,
                "last_status": "never",
                "created_at": 1.0,
                "updated_at": 1.0,
                "revision": "revision",
                "legacy_schedule": {"timezone": "Europe/Madrid"},
            },
        ),
        (
            catalog_models.SkillAutomationRunResponse,
            {
                "id": "b" * 32,
                "automation_id": "a" * 32,
                "status": "completed",
                "ai_calls": 1,
                "confirmation_count": 0,
                "error_code": None,
                "started_at": 1.0,
                "finished_at": 2.0,
                "legacy_receipt": "kept",
            },
        ),
    ],
)
def test_catalog_models_preserve_legacy_json_exactly(
    model: type[BaseModel],
    payload: dict[str, object],
) -> None:
    serialized = model.model_validate(payload).model_dump(
        mode="json",
        exclude_unset=True,
    )
    assert serialized == payload


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (
            governance_models.CapabilityJobResponse,
            {
                "job_id": "reader:legacy-job",
                "status": "running",
                "legacy_extension": {"attempt": 2, "markers": ["a", None]},
            },
        ),
        (
            governance_models.EvaluationCandidateResponse,
            {
                "id": "legacy-candidate",
                "review_status": "pending_review",
                "synthetic_case": {"id": "case", "message": "Synthetic"},
                "legacy_score": 0.75,
            },
        ),
        (
            governance_models.ModelEvaluationResponse,
            {
                "evaluation_id": 7,
                "provider": "fixture",
                "model": "fixture-model",
                "agent_id": "assistant",
                "score": 1.0,
                "passed": 3,
                "total": 3,
                "latency_ms": 4,
                "input_tokens": 5,
                "output_tokens": 6,
                "estimated_cost_usd": 0.0,
                "failure_codes": [],
                "created_at": "2026-09-03T00:00:00+00:00",
                "legacy_route": "fixture/model",
            },
        ),
        (
            governance_models.AutomationApprovalResponse,
            {
                "type": "confirmation_required",
                "confirmation_id": "a" * 32,
                "action": "governed_tool",
                "title_key": "title",
                "summary_key": "summary",
                "details": {"tool": "fixture", "extension": 7},
                "destructive": False,
                "created_at": 1.0,
                "expires_at": 2.0,
                "status": "pending",
                "result": {},
                "error_code": "",
                "agent_id": "assistant",
                "session_id": "session",
                "legacy_origin": "automation",
            },
        ),
    ],
)
def test_forward_compatible_models_preserve_legacy_json_exactly(
    model: type[governance_models.ForwardCompatibleGovernanceResponse],
    payload: dict[str, object],
) -> None:
    serialized = model.model_validate(payload).model_dump(
        mode="json",
        exclude_unset=True,
    )
    assert serialized == payload


def test_job_monkeypatch_seams_keep_exact_http_payloads(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    context = WorkspaceContext(
        workspace_id="personal",
        user_id="owner",
        role="owner",
        vault_path=tmp_path,
    )
    status_payload: dict[str, object] = {
        "job_id": "reader:legacy-job",
        "status": "running",
        "legacy_extension": {"nested": [1, True, None]},
    }
    result_payload: dict[str, object] = {
        "job_id": "reader:legacy-job",
        "status": "complete",
        "result": {"rows": [1, 2]},
        "legacy_report": "kept",
    }

    monkeypatch.setattr(
        agent_skills_routes,
        "get_capability_job_status",
        lambda _vault, _job_id: status_payload,
    )
    monkeypatch.setattr(
        agent_skills_routes,
        "read_capability_job_result",
        lambda _vault, _job_id: result_payload,
    )

    app = FastAPI()
    app.include_router(agent_skills_routes.router, prefix="/api")
    app.dependency_overrides[get_workspace_context] = lambda: context
    client = TestClient(app)

    assert client.get("/api/ai/jobs/reader:legacy-job").json() == status_payload
    assert client.get("/api/ai/jobs/reader:legacy-job/result").json() == result_payload
    assert agent_skills_routes.get_governed_job is governance_routes.get_governed_job

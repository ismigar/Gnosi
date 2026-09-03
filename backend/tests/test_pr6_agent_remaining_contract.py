"""Focused compatibility contracts for the remaining PR6 agent modules."""

from __future__ import annotations

from pathlib import Path
from typing import Any, get_type_hints

from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRoute

from backend.agent import turn_contract
from backend.api import agent_routes
from backend.domains.agent import turn_citations, turn_evidence
from backend.domains.agent.routes import (
    attachments,
    chat_route,
    chat_stream_errors,
    confirmations,
    misc,
    sessions,
    workflow,
)
from backend.domains.agent.routes.contracts import (
    ExternalContextSourceResponse,
    InternalContextSourceResponse,
)
from backend.domains.agent.routes.router import router
from backend.domains.agent.routes.response_models import (
    AgentAttachmentUploadResponse,
    AgentCapabilityAuditListResponse,
    AgentChatFeedbackResponse,
    AgentConfirmationCancelResponse,
    AgentConfirmationExecutionResponse,
    AgentConfirmationListResponse,
    AgentConfirmationRecordResponse,
    AgentDeleteResponse,
    AgentReplayResponse,
    AgentSessionMessagesResponse,
    AgentStreamCancellationResponse,
)

EXPECTED_AGENT_ROUTES = [
    ("POST", "/chat/attachments"),
    ("DELETE", "/chat/attachments"),
    ("GET", "/chat/confirmations"),
    ("GET", "/chat/capability-audit"),
    ("GET", "/chat/replays/{trace_id}"),
    ("GET", "/chat/confirmations/{action_id}"),
    ("POST", "/chat/confirmations/{action_id}/confirm"),
    ("POST", "/chat/confirmations/{action_id}/cancel"),
    ("DELETE", "/chat/sessions/{agent_id}/{session_id}"),
    ("POST", "/chat/sessions/{agent_id}/{session_id}/rewind"),
    ("GET", "/chat/sessions/{agent_id}/{session_id}"),
    ("GET", "/ai/model-reliability"),
    ("GET", "/agent/context-sources"),
    ("GET", "/agent/internal-sources"),
    ("POST", "/chat/feedback"),
    ("GET", "/chat/streams/{stream_id}"),
    ("POST", "/chat/streams/{stream_id}/cancel"),
    ("POST", "/chat"),
]


TYPED_JSON_RESPONSES = {
    ("POST", "/chat/attachments"): AgentAttachmentUploadResponse,
    ("DELETE", "/chat/attachments"): AgentDeleteResponse,
    ("GET", "/chat/confirmations"): AgentConfirmationListResponse,
    ("GET", "/chat/capability-audit"): AgentCapabilityAuditListResponse,
    ("GET", "/chat/replays/{trace_id}"): AgentReplayResponse,
    ("GET", "/chat/confirmations/{action_id}"): AgentConfirmationRecordResponse,
    (
        "POST",
        "/chat/confirmations/{action_id}/confirm",
    ): AgentConfirmationExecutionResponse,
    (
        "POST",
        "/chat/confirmations/{action_id}/cancel",
    ): AgentConfirmationCancelResponse,
    ("DELETE", "/chat/sessions/{agent_id}/{session_id}"): AgentDeleteResponse,
    (
        "POST",
        "/chat/sessions/{agent_id}/{session_id}/rewind",
    ): AgentSessionMessagesResponse,
    ("GET", "/chat/sessions/{agent_id}/{session_id}"): AgentSessionMessagesResponse,
    ("POST", "/chat/feedback"): AgentChatFeedbackResponse,
    ("POST", "/chat/streams/{stream_id}/cancel"): AgentStreamCancellationResponse,
}


STREAMING_RESPONSES = {
    ("GET", "/chat/streams/{stream_id}"),
    ("POST", "/chat"),
}


def _route_contracts() -> list[tuple[str, str]]:
    contracts: list[tuple[str, str]] = []
    for route in router.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted(route.methods or set()):
            contracts.append((method, route.path))
    return contracts


def _agent_routes_by_contract() -> dict[tuple[str, str], APIRoute]:
    return {
        (method, route.path): route
        for route in router.routes
        if isinstance(route, APIRoute)
        for method in route.methods or set()
    }


def test_agent_route_facade_preserves_router_identity_and_order() -> None:
    assert getattr(agent_routes, "router") is router
    assert _route_contracts() == EXPECTED_AGENT_ROUTES


def test_context_source_catalogues_publish_typed_safe_contracts() -> None:
    routes = {
        route.endpoint.__name__: route
        for route in router.routes
        if isinstance(route, APIRoute)
        and route.endpoint.__name__ in {"list_context_sources", "list_internal_context_sources"}
    }
    assert routes["list_context_sources"].response_model == list[ExternalContextSourceResponse]
    assert (
        routes["list_internal_context_sources"].response_model
        == list[InternalContextSourceResponse]
    )


def test_remaining_agent_json_routes_publish_named_response_models() -> None:
    routes = _agent_routes_by_contract()

    assert {
        contract: routes[contract].response_model for contract in TYPED_JSON_RESPONSES
    } == TYPED_JSON_RESPONSES


def test_only_ndjson_agent_routes_keep_response_model_disabled() -> None:
    routes = _agent_routes_by_contract()

    assert {
        contract
        for contract, route in routes.items()
        if route.endpoint.__module__
        in {
            "backend.domains.agent.routes.attachments",
            "backend.domains.agent.routes.chat_route",
            "backend.domains.agent.routes.confirmations",
            "backend.domains.agent.routes.misc",
            "backend.domains.agent.routes.sessions",
        }
        and route.response_model is None
    } == STREAMING_RESPONSES
    for contract in STREAMING_RESPONSES:
        assert get_type_hints(routes[contract].endpoint)["return"] is StreamingResponse


def test_agent_openapi_references_every_named_json_response_model() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    schema = app.openapi()

    for (method, path), model in TYPED_JSON_RESPONSES.items():
        response_schema = schema["paths"][f"/api{path}"][method.lower()]["responses"]["200"][
            "content"
        ]["application/json"]["schema"]
        assert response_schema == {
            "$ref": f"#/components/schemas/{model.__name__}",
        }


def test_agent_response_models_preserve_legacy_json_shapes() -> None:
    session = {
        "messages": [
            {"role": "user", "content": "Pregunta", "turn_id": "turn-1"},
            {
                "role": "assistant",
                "content": "Resposta",
                "turn_id": "turn-1",
                "timings": {"total_ms": 1250, "model_calls": 1},
            },
        ],
    }
    assert (
        AgentSessionMessagesResponse.model_validate(session).model_dump(
            mode="json",
            exclude_none=True,
        )
        == session
    )

    confirmation = {
        "type": "confirmation_required",
        "confirmation_id": "a" * 32,
        "action": "empty_trash",
        "title_key": "title",
        "summary_key": "summary",
        "details": {"count": 2},
        "destructive": True,
        "created_at": 1.0,
        "expires_at": 2.0,
        "status": "pending",
        "result": {},
        "error_code": "",
    }
    assert (
        AgentConfirmationRecordResponse.model_validate(confirmation).model_dump(
            mode="json",
            exclude_none=True,
        )
        == confirmation
    )

    execution = {
        "status": "partial",
        "confirmation_id": "b" * 32,
        "action": "bulk_update_rows",
        "result_status": "partial",
        "result": {"updated_count": 2, "rollback_failed_ids": ["row-3"]},
    }
    assert (
        AgentConfirmationExecutionResponse.model_validate(execution).model_dump(
            mode="json",
            exclude_none=True,
        )
        == execution
    )


def test_turn_contract_preserves_citation_exports() -> None:
    assert turn_contract.verify_response is turn_evidence.verify_response
    assert turn_contract._claim_citations is turn_citations._claim_citations
    assert turn_contract._safe_source_href is turn_citations._safe_source_href


def test_agent_route_facade_propagates_explicit_monkeypatch_seams(
    monkeypatch: Any,
) -> None:
    sentinel: Any = object()
    monkeypatch.setattr(agent_routes, "_attachment_context", sentinel)
    assert getattr(attachments, "_attachment_context") is sentinel

    monkeypatch.setattr(agent_routes, "prepare_agent_runtime", sentinel)
    assert getattr(workflow, "prepare_agent_runtime") is sentinel
    assert getattr(confirmations, "prepare_agent_runtime") is sentinel

    monkeypatch.setattr(agent_routes, "_vault_scope", sentinel)
    assert getattr(attachments, "_vault_scope") is sentinel
    assert getattr(confirmations, "_vault_scope") is sentinel
    assert getattr(sessions, "_vault_scope") is sentinel
    assert getattr(misc, "_vault_scope") is sentinel
    assert getattr(chat_route, "_vault_scope") is sentinel

    monkeypatch.setattr(agent_routes, "record_quality_signal", sentinel)
    assert getattr(misc, "record_quality_signal") is sentinel
    assert getattr(chat_stream_errors, "record_quality_signal") is sentinel

    monkeypatch.setattr(agent_routes, "execute_confirmed_action", sentinel)
    assert getattr(confirmations, "execute_confirmed_action") is sentinel


def test_owned_agent_modules_respect_line_guardrail() -> None:
    root = Path(__file__).resolve().parents[2]
    owned = [
        root / "backend/api/agent_routes.py",
        root / "backend/domains/agent/turn_citations.py",
        root / "backend/domains/agent/turn_evidence.py",
        *(root / "backend/domains/agent/routes").glob("*.py"),
    ]
    oversized = {
        path.relative_to(root).as_posix(): len(path.read_text(encoding="utf-8").splitlines())
        for path in owned
        if len(path.read_text(encoding="utf-8").splitlines()) > 800
    }
    assert oversized == {}

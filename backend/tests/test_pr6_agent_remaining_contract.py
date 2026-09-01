"""Focused compatibility contracts for the remaining PR6 agent modules."""

from __future__ import annotations

from pathlib import Path
from typing import Any

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
from backend.domains.agent.routes.router import router

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


def _route_contracts() -> list[tuple[str, str]]:
    contracts: list[tuple[str, str]] = []
    for route in router.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in sorted(route.methods or set()):
            contracts.append((method, route.path))
    return contracts


def test_agent_route_facade_preserves_router_identity_and_order() -> None:
    assert getattr(agent_routes, "router") is router
    assert _route_contracts() == EXPECTED_AGENT_ROUTES


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

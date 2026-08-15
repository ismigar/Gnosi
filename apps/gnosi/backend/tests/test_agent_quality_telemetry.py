"""Privacy-safe production feedback and evaluation-candidate tests."""
from __future__ import annotations

import sqlite3
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.agent.evals.runner import run_evaluations
from backend.api import agent_routes, agent_skills_routes
from backend.services import agent_quality_telemetry as telemetry
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


def _scope():
    return {
        "vault_scope": "vault-scope",
        "workspace_id": "workspace-1",
        "user_id": "user-1",
    }


def _record_inventory_feedback(turn_id: str, rating: str = "down") -> str:
    return telemetry.record_quality_signal(
        _scope(),
        agent_id="brain",
        session_id="session-private",
        turn_id=turn_id,
        signal="feedback",
        rating=rating,
        language="ca",
        mode="inventory",
        domains=["vault"],
        route="Brain",
        execution="foreground",
        output_strategy="deterministic",
        required_tool="inventory_context",
        verification_status="limited",
        limitations=["claim_citations_incomplete"],
        tool_names=["inventory_context"],
        duration_ms=16_000,
    )


def test_negative_feedback_creates_deduplicated_runnable_candidate(
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(
        telemetry,
        "load_params",
        lambda strict_env=False: SimpleNamespace(
            paths={"LOCAL_DATA": tmp_path / "local-data"}
        ),
    )
    telemetry._SCHEMA_READY.clear()

    first_event = _record_inventory_feedback("turn-1")
    repeated_event = _record_inventory_feedback("turn-1")
    _record_inventory_feedback("turn-2")
    candidates = telemetry.list_evaluation_candidates(_scope())

    assert first_event == repeated_event
    assert len(candidates) == 1
    candidate = candidates[0]
    assert candidate["occurrence_count"] == 2
    assert candidate["review_status"] == "pending_review"
    assert candidate["scenario"]["duration_bucket"] == "slow"
    assert candidate["synthetic_case"]["message"] == (
        "List all records in the attached Vault."
    )
    assert "session-private" not in str(candidate)

    accepted = telemetry.review_evaluation_candidate(
        _scope(), candidate["id"], "accepted"
    )
    assert accepted["review_status"] == "accepted"
    cases = telemetry.reviewed_evaluation_cases(_scope())
    report = run_evaluations(cases)
    assert report["total"] == 1
    assert report["score"] == 1.0, report["results"]


def test_feedback_clear_rebuilds_pending_candidates(tmp_path, monkeypatch):
    monkeypatch.setattr(
        telemetry,
        "load_params",
        lambda strict_env=False: SimpleNamespace(
            paths={"LOCAL_DATA": tmp_path / "local-data"}
        ),
    )
    telemetry._SCHEMA_READY.clear()

    _record_inventory_feedback("turn-1")
    assert len(telemetry.list_evaluation_candidates(_scope())) == 1
    _record_inventory_feedback("turn-1", rating="clear")
    assert telemetry.list_evaluation_candidates(_scope()) == []


def test_error_candidate_and_database_are_metadata_only(tmp_path, monkeypatch):
    local_data = tmp_path / "local-data"
    monkeypatch.setattr(
        telemetry,
        "load_params",
        lambda strict_env=False: SimpleNamespace(paths={"LOCAL_DATA": local_data}),
    )
    telemetry._SCHEMA_READY.clear()

    telemetry.record_quality_signal(
        _scope(),
        agent_id="brain",
        session_id="session-1",
        turn_id="turn-error",
        signal="error",
        error_code="agent_loop_exhausted",
        mode="analysis",
        domains=["reader"],
        route="Brain",
        execution="background",
        required_tool="start_reader_context_analysis",
        tool_names=["start_reader_context_analysis"],
        duration_ms=116_000,
    )
    candidate = telemetry.list_evaluation_candidates(_scope())[0]

    assert candidate["scenario"]["error_code"] == "agent_loop_exhausted"
    assert candidate["scenario"]["duration_bucket"] == "timeout_range"
    assert candidate["synthetic_case"]["runtime_expectations"][
        "must_not_repeat_error_code"
    ] == "agent_loop_exhausted"

    with sqlite3.connect(local_data / "agent_quality.sqlite") as connection:
        columns = {
            row[1]
            for row in connection.execute(
                "PRAGMA table_info(agent_quality_events)"
            ).fetchall()
        }
    forbidden = {
        "prompt", "message", "response", "content", "source_id", "title",
        "path", "url", "tool_payload",
    }
    assert columns.isdisjoint(forbidden)


def test_chat_feedback_endpoint_rejects_response_content(monkeypatch, tmp_path):
    context = WorkspaceContext(
        workspace_id="workspace-1",
        user_id="user-1",
        role="owner",
        vault_path=tmp_path,
    )
    recorded = []
    monkeypatch.setattr(
        agent_routes, "_vault_scope", lambda: (tmp_path, "vault-scope")
    )
    monkeypatch.setattr(
        agent_routes,
        "record_quality_signal",
        lambda scope, **payload: recorded.append((scope, payload)) or "event-1",
    )
    app = FastAPI()
    app.include_router(agent_routes.router, prefix="/api")
    app.dependency_overrides[get_workspace_context] = lambda: context
    client = TestClient(app)
    payload = {
        "agent_id": "brain",
        "session_id": "session-1",
        "turn_id": "turn-1",
        "rating": "down",
        "mode": "inventory",
        "domains": ["vault"],
        "route": "Brain",
        "required_tool": "inventory_context",
    }

    response = client.post("/api/chat/feedback", json=payload)
    rejected = client.post(
        "/api/chat/feedback",
        json={**payload, "content": "private response text"},
    )

    assert response.status_code == 200, response.text
    assert response.json() == {"status": "recorded", "event_id": "event-1"}
    assert recorded[0][1]["signal"] == "feedback"
    assert rejected.status_code == 422


def test_admin_can_review_and_run_synthetic_candidates(monkeypatch, tmp_path):
    context = WorkspaceContext(
        workspace_id="workspace-1",
        user_id="user-1",
        role="owner",
        vault_path=tmp_path,
    )
    case = {
        "id": "telemetry-case",
        "message": "Hello, how can you help?",
        "provider": "ollama",
        "expected": {
            "mode": "conversation",
            "route": "General",
            "execution": "foreground",
        },
    }
    candidate = {
        "id": "eval-case",
        "review_status": "pending_review",
        "occurrence_count": 1,
        "synthetic_case": case,
    }
    monkeypatch.setattr(
        agent_skills_routes,
        "list_evaluation_candidates",
        lambda _scope, limit=200: [candidate],
    )
    monkeypatch.setattr(
        agent_skills_routes,
        "review_evaluation_candidate",
        lambda _scope, candidate_id, decision: {
            **candidate,
            "id": candidate_id,
            "review_status": decision,
        },
    )
    monkeypatch.setattr(
        agent_skills_routes,
        "reviewed_evaluation_cases",
        lambda _scope: [case],
    )
    app = FastAPI()
    app.include_router(agent_skills_routes.router, prefix="/api")
    app.dependency_overrides[get_workspace_context] = lambda: context
    client = TestClient(app)

    listed = client.get("/api/ai/evals/candidates")
    reviewed = client.post(
        "/api/ai/evals/candidates/eval-case/review",
        json={"decision": "accepted"},
    )
    report = client.post("/api/ai/evals/candidates/run")

    assert listed.status_code == 200
    assert reviewed.json()["review_status"] == "accepted"
    assert report.status_code == 200
    assert report.json()["score"] == 1.0

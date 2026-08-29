"""Typed route contract for model reliability evidence."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from backend.domains.agent.routes import misc
from backend.services.workspace_service import WorkspaceContext


def _model_reliability_route() -> APIRoute:
    return next(
        route
        for route in misc.router.routes
        if isinstance(route, APIRoute) and route.endpoint is misc.model_reliability
    )


def test_model_reliability_route_has_an_exact_response_model() -> None:
    route = _model_reliability_route()

    assert route.response_model is misc.ModelReliabilityResponse
    assert route.status_code is None
    assert set(misc.ModelReliabilityResponse.model_fields) == {"window_days", "models"}
    assert set(misc.ModelReliabilityEntryResponse.model_fields) == {
        "provider",
        "model_id",
        "window_days",
        "reasons",
        "model_fault_total",
        "total",
        "top_model_reason",
    }


def test_model_reliability_route_preserves_json_status_and_scope(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    report_rows: list[dict[str, Any]] = [
        {
            "provider": "groq",
            "model_id": "llama-3.3-70b",
            "window_days": 14,
            "reasons": {"tool_use_failed": 2, "timeout": 1},
            "model_fault_total": 2,
            "total": 3,
            "top_model_reason": "tool_use_failed",
        },
        {
            "provider": "openrouter",
            "model_id": "openai/gpt-4o-mini",
            "window_days": 14,
            "reasons": {"insufficient_credit": 1},
            "model_fault_total": 0,
            "total": 1,
            "top_model_reason": None,
        },
    ]
    captured: dict[str, Any] = {}

    def fake_reliability_report(
        window_days: int,
        *,
        scope_key: str | None = None,
    ) -> list[dict[str, Any]]:
        captured.update(window_days=window_days, scope_key=scope_key)
        return report_rows

    monkeypatch.setattr(misc, "_vault_scope", lambda: (tmp_path, "vault-scope"))
    monkeypatch.setattr(misc, "reliability_report", fake_reliability_report)

    context = WorkspaceContext(
        workspace_id="workspace-1",
        user_id="user-1",
        role="viewer",
        vault_path=tmp_path,
    )
    route = _model_reliability_route()
    role_dependency = route.dependant.dependencies[0].call
    assert role_dependency is not None

    app = FastAPI()
    app.include_router(misc.router, prefix="/api")
    app.dependency_overrides[role_dependency] = lambda: context

    response = TestClient(app).get("/api/ai/model-reliability?window_days=14")

    assert response.status_code == 200
    assert response.json() == {"window_days": 14, "models": report_rows}
    assert captured == {
        "window_days": 14,
        "scope_key": "vault-scope:workspace-1:user-1",
    }

"""Typed OpenAPI contract for development-memory analytics."""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.routing import APIRoute

from backend.api import analytics_routes
from backend.domains.analytics.schemas import (
    AnalyticsOverviewResponse,
    DirectiveAnalyticsPageResponse,
    DirectiveContentUpdateRequest,
    TrapAnalyticsPageResponse,
)


def _focused_openapi() -> dict[str, object]:
    app = FastAPI()
    app.include_router(analytics_routes.router)
    return app.openapi()


def test_analytics_json_routes_all_have_response_models() -> None:
    routes = [route for route in analytics_routes.router.routes if isinstance(route, APIRoute)]

    assert routes
    assert all(route.response_model is not None for route in routes)


def test_analytics_openapi_exposes_typed_pages_and_update_body() -> None:
    paths = _focused_openapi()["paths"]

    assert paths["/api/analytics/"]["get"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/AnalyticsOverviewResponse"}
    assert paths["/api/analytics/directives"]["get"]["responses"]["200"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/DirectiveAnalyticsPageResponse"}
    assert paths["/api/analytics/traps"]["get"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/TrapAnalyticsPageResponse"}
    assert paths["/api/analytics/directives/content"]["post"]["requestBody"]["content"][
        "application/json"
    ]["schema"] == {"$ref": "#/components/schemas/DirectiveContentUpdateRequest"}


def test_analytics_models_preserve_dashboard_payloads() -> None:
    overview_payload = {
        "tools": {
            "total_tools": 3,
            "pending": 1,
            "approved": 2,
            "rejected": 0,
            "by_risk_level": {"low": 2, "medium": 1},
            "created_last_7_days": 1,
            "internal_skills": 0,
        },
        "directives": {"total": 4, "traps_documented": 6},
        "errors_prevented": 6,
    }
    directives_payload = {
        "directives": [
            {
                "name": "Openapi contract",
                "category": "Directive",
                "size_bytes": 1024,
                "trap_count": 2,
                "path": "/private/directives/openapi.md",
            }
        ],
        "total": 1,
        "limit": 12,
        "offset": 0,
        "has_more": False,
    }
    traps_payload = {
        "traps": [
            {
                "date": "29/08/2026",
                "trap": "Reuse a consumed response body",
                "solution": "Create a new response per request",
                "source": "Openapi contract",
                "category": "Directive",
            }
        ],
        "total": 1,
        "limit": 15,
        "offset": 0,
        "has_more": False,
    }

    assert AnalyticsOverviewResponse.model_validate(overview_payload).model_dump() == (
        overview_payload
    )
    assert (
        DirectiveAnalyticsPageResponse.model_validate(directives_payload).model_dump()
        == directives_payload
    )
    assert TrapAnalyticsPageResponse.model_validate(traps_payload).model_dump() == (traps_payload)
    assert DirectiveContentUpdateRequest(path="/tmp/a.md", content="text").model_dump() == {
        "path": "/tmp/a.md",
        "content": "text",
    }

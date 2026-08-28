"""Typed HTTP contract for planning state, schedules, and mutations."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from backend.api import planning_routes
from backend.domains.planning.schemas import (
    BaselineListResponse,
    PlanningStateResponse,
    ProjectScheduleResponse,
)
from backend.services.workspace_service import WorkspaceContext, get_workspace_context


EMPTY_ALLOCATION = {
    "revision": 0,
    "assignment_summaries": [],
    "buckets": [],
    "warnings": [],
    "total_estimated_cost": 0.0,
}

SHORT_SCHEDULE = {
    "projectId": "project-1",
    "tasks": [],
    "diagnostics": [],
    "criticalTaskIds": [],
    "scheduleRevision": 0,
}


def _focused_app() -> FastAPI:
    app = FastAPI()
    app.include_router(planning_routes.router, prefix="/api")
    app.dependency_overrides[get_workspace_context] = lambda: WorkspaceContext(
        workspace_id="personal",
        user_id="contract-test",
        role="owner",
        vault_path=Path("/tmp/gnosi-planning-contract"),
    )
    return app


def test_planning_openapi_exposes_concrete_response_models() -> None:
    app = _focused_app()
    schema = app.openapi()
    paths = schema["paths"]

    operations = [
        operation
        for path, path_item in paths.items()
        if path.startswith("/api/planning")
        for method, operation in path_item.items()
        if method in {"get", "post", "patch", "delete"}
    ]
    assert len(operations) == 23
    assert all(
        operation["responses"]["200"]["content"]["application/json"]["schema"].get("$ref")
        for operation in operations
    )

    assert paths["/api/planning/state"]["get"]["responses"]["200"]["content"]["application/json"][
        "schema"
    ] == {"$ref": "#/components/schemas/PlanningStateResponse"}
    assert paths["/api/planning/projects/{project_id}/schedule"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"] == {"$ref": "#/components/schemas/ProjectScheduleResponse"}
    assert paths["/api/planning/projects/{project_id}/baselines"]["get"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"] == {"$ref": "#/components/schemas/BaselineListResponse"}
    assert paths["/api/planning/projects/{project_id}/leveling/proposals"]["post"]["responses"][
        "200"
    ]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/StoredLevelingProposalResponse"
    }
    assert paths["/api/planning/recurrences/{recurrence_id}/materialize"]["post"]["responses"][
        "200"
    ]["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/RecurrenceMaterializationResponse"
    }
    assert paths["/api/planning/assignments/{assignment_id}"]["delete"]["responses"]["200"][
        "content"
    ]["application/json"]["schema"] == {"$ref": "#/components/schemas/PlanningDeletionResponse"}


def test_every_planning_route_excludes_unset_legacy_fields() -> None:
    routes = [route for route in planning_routes.router.routes if isinstance(route, APIRoute)]

    assert len(routes) == 23
    assert all(route.response_model is not None for route in routes)
    assert all(route.response_model_exclude_unset is True for route in routes)


def test_short_schedule_http_payload_is_not_expanded(monkeypatch) -> None:
    class ShortScheduleIndex:
        def load(self) -> dict[str, object]:
            return {"projects": {"project-1": SHORT_SCHEDULE}}

    monkeypatch.setattr(planning_routes, "_index", ShortScheduleIndex)
    response = TestClient(_focused_app()).get("/api/planning/projects/project-1/schedule")

    assert response.status_code == 200
    assert response.json() == SHORT_SCHEDULE


def test_v1_state_records_keep_their_short_shapes() -> None:
    legacy_state = {
        "version": 2,
        "revision": 7,
        "calendars": [
            {
                "id": "project-default",
                "name": "Project default",
                "working_weekdays": [1, 2, 3, 4, 5],
                "holidays": [],
                "hours_per_day": 8.0,
                "workday_start": "09:00",
            }
        ],
        "resources": [
            {
                "id": "resource-1",
                "name": "Ada",
                "type": "work",
                "calendar_id": "project-default",
                "availability_units": 100.0,
                "standard_rate": 80.0,
                "cost_per_use": 0.0,
                "active": True,
            }
        ],
        "assignments": [
            {
                "id": "assignment-1",
                "task_id": "task-1",
                "resource_id": "resource-1",
                "units": 100.0,
                "planned_work_hours": 4.0,
                "remaining_work_hours": 4.0,
                "actual_work_hours": 0.0,
                "rate_override": None,
                "start": None,
                "end": None,
            }
        ],
        "recurrences": [],
        "defaults": {"currency": "EUR", "project_relation_field_id": None},
        "allocation": EMPTY_ALLOCATION,
    }

    serialized = PlanningStateResponse.model_validate(legacy_state).model_dump(exclude_unset=True)

    assert serialized == legacy_state
    assert "overtime_rate" not in serialized["resources"][0]
    assert "task_type" not in serialized["assignments"][0]


def test_legacy_baseline_and_schedule_variants_remain_short() -> None:
    baseline = {
        "id": "baseline-1",
        "type": "baseline",
        "projectId": "project-1",
        "name": "Initial",
        "createdAt": "2026-07-27T09:00:00",
        "scheduleRevision": 1,
        "schedule": SHORT_SCHEDULE,
    }

    schedule = ProjectScheduleResponse.model_validate(SHORT_SCHEDULE).model_dump(exclude_unset=True)
    baselines = BaselineListResponse.model_validate({"baselines": [baseline]}).model_dump(
        exclude_unset=True
    )

    assert schedule == SHORT_SCHEDULE
    assert baselines == {"baselines": [baseline]}
    assert "allocation" not in baselines["baselines"][0]


def test_planning_error_statuses_and_payloads_are_unchanged() -> None:
    client = TestClient(_focused_app())

    worklog = client.post(
        "/api/planning/worklogs",
        json={"task_id": "task-1", "date": "2026-07-27", "hours": 0},
    )
    materialization = client.post("/api/planning/recurrences/repeat-1/materialize?limit=0")
    protected_calendar = client.delete("/api/planning/calendars/project-default")

    assert worklog.status_code == 422
    assert worklog.json() == {"detail": "worklog hours cannot be zero"}
    assert materialization.status_code == 422
    assert materialization.json() == {"detail": "limit must be between 1 and 200"}
    assert protected_calendar.status_code == 409
    assert protected_calendar.json() == {"detail": "The project default calendar cannot be deleted"}

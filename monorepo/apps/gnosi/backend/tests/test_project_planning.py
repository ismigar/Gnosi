"""Coverage for normalized planning resources, assignments, and allocation."""

import asyncio

import pytest

from backend.api import planning_routes as routes
from backend.services.project_planning import (
    PlanningStore,
    PlanningValidationError,
    calculate_allocation,
    default_state,
    normalize_assignment,
    normalize_resource,
)


def _resource(resource_id="r1", **overrides):
    return {
        "id": resource_id,
        "name": "Ada",
        "type": "work",
        "calendar_id": "project-default",
        "availability_units": 100,
        "standard_rate": 10,
        "overtime_rate": 0,
        "cost_per_use": 5,
        "active": True,
        **overrides,
    }


def _assignment(assignment_id="a1", **overrides):
    return {
        "id": assignment_id,
        "task_id": "task-1",
        "resource_id": "r1",
        "units": 100,
        "planned_work_hours": 6,
        "remaining_work_hours": 6,
        "actual_work_hours": 0,
        "rate_override": None,
        "start": "2026-07-27T09:00",
        "end": "2026-07-27T17:00",
        **overrides,
    }


def test_allocation_reports_cost_and_resource_overallocation():
    state = default_state()
    state["resources"] = [_resource()]
    state["assignments"] = [_assignment(), _assignment("a2", task_id="task-2")]

    report = calculate_allocation(state)

    assert report["total_estimated_cost"] == 130
    assert report["buckets"] == [{
        "resource_id": "r1", "resource_name": "Ada", "date": "2026-07-27",
        "assigned_hours": 12.0, "capacity_hours": 8.0, "overallocated_hours": 4.0,
        "assignment_ids": ["a1", "a2"],
    }]
    assert report["warnings"][0]["code"] == "resource_overallocated"
    assert report["warnings"][0]["assignment_ids"] == ["a1", "a2"]


def test_assignment_requires_existing_resource_and_valid_range():
    with pytest.raises(PlanningValidationError, match="resource"):
        normalize_assignment({"task_id": "task", "resource_id": "missing"}, set())
    with pytest.raises(PlanningValidationError, match="after start"):
        normalize_assignment(
            {"task_id": "task", "resource_id": "r1", "start": "2026-07-27T10:00", "end": "2026-07-27T09:00"},
            {"r1"},
        )


def test_resource_rejects_missing_calendar():
    with pytest.raises(PlanningValidationError, match="calendar"):
        normalize_resource({"name": "Ada", "calendar_id": "missing"}, {"project-default"})


def test_store_is_vault_scoped_and_revisions_increase(tmp_path):
    store = PlanningStore(tmp_path / ".gnosi")
    state = store.load()
    state["resources"].append(_resource())
    first = store.save(state)
    second = store.save(first)

    assert first["revision"] == 1
    assert second["revision"] == 2
    assert store.load()["resources"][0]["name"] == "Ada"


@pytest.fixture()
def route_store(tmp_path, monkeypatch):
    store = PlanningStore(tmp_path / ".gnosi")
    monkeypatch.setattr(routes, "_store", lambda: store)
    monkeypatch.setattr(routes, "_mutation_lock", asyncio.Lock())
    return store


def test_resource_and_assignment_api_mutations(route_store):
    async def scenario():
        created = await routes.create_resource(routes.ResourcePayload(name="Ada", standard_rate=12))
        resource = created["resource"]
        assignment = await routes.create_assignment(routes.AssignmentPayload(
            task_id="task-1", resource_id=resource["id"], planned_work_hours=4,
        ))
        state = await routes.get_planning_state()
        return resource, assignment, state

    resource, assignment, state = asyncio.run(scenario())
    assert resource["calendar_id"] == "project-default"
    assert assignment["assignment"]["task_id"] == "task-1"
    assert state["revision"] == 2
    assert state["allocation"]["total_estimated_cost"] == 48


def test_api_rejects_assignment_with_unknown_resource(route_store):
    async def scenario():
        with pytest.raises(Exception) as error:
            await routes.create_assignment(routes.AssignmentPayload(task_id="task-1", resource_id="missing"))
        return error.value

    error = asyncio.run(scenario())
    assert getattr(error, "status_code", None) == 422

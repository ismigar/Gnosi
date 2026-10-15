"""Regression coverage for project boundaries using disposable Vault data only."""

import asyncio
from copy import deepcopy
import json

from fastapi import HTTPException
import pytest

from backend.api import planning_routes as routes
from backend.services.planning_engine import ScheduleIndex
from backend.services.planning_scheduler import refresh_vault_schedules
from backend.services.project_planning import (
    DEFAULT_CALENDAR_ID, PlanningStore, default_state, normalize_assignment, normalize_resource,
)


@pytest.fixture()
def planned_vault(tmp_path, monkeypatch):
    monkeypatch.setenv("GNOSI_DATA_DIR", str(tmp_path / "local"))
    vault = tmp_path / "vault"
    config = vault / ".gnosi"
    config.mkdir(parents=True)
    (config / "plugins.json").write_text(json.dumps({
        "schema_version": 2, "enabled_builtin": ["project-planning"],
        "enabled_third_party": [], "disabled": [], "granted": {},
        "settings": {"project-planning": {
            "task_table_id": "tasks", "project_table_id": "projects",
            "project_relation_field_id": "fld_project1",
        }},
    }))
    registry = vault / "BD" / "vault_db_registry.json"
    registry.parent.mkdir()
    registry.write_text(json.dumps({"tables": [{"id": "tasks", "properties": [{
        "id": "fld_project1", "name": "Project", "type": "relation", "aliases": ["Old project"],
    }]}]}))
    task = vault / "task.md"
    task.write_text("""---
id: task-1
title: Task one
table_id: tasks
Project: [project-1]
Window:
  start: '2026-10-15T09:00'
  end: ''
  durationDays: 1
  startMode: manual
  endMode: automatic
---
Unchanged body
""")
    monkeypatch.setattr(routes, "get_active_vault_path", lambda: str(vault))
    return vault, task


@pytest.mark.parametrize("key", ["Project", "Old project", "fld_project1"])
def test_relation_ids_resolve_current_names_aliases_and_legacy_id_keys(planned_vault, key):
    vault, task = planned_vault
    task.write_text(task.read_text().replace("Project:", f"{key}:"))
    before = task.read_bytes()
    schedule = asyncio.run(routes.get_project_schedule("project-1"))
    assert [item["id"] for item in schedule["tasks"]] == ["task-1"]
    assert schedule["tasks"][0]["end"] == "2026-10-15T17:00"
    assert task.read_bytes() == before  # Even automatic task dates are never written by reads.
    revision = schedule["scheduleRevision"]
    assert asyncio.run(routes.get_project_schedule("project-1"))["scheduleRevision"] == revision


def test_reassignment_and_deletion_clear_previous_project_tasks(planned_vault):
    vault, task = planned_vault
    first = asyncio.run(routes.get_project_schedule("project-1"))
    task.write_text(task.read_text().replace("[project-1]", "[project-2]"))
    second = asyncio.run(routes.get_project_schedule("project-2"))
    previous = asyncio.run(routes.get_project_schedule("project-1"))
    assert len(second["tasks"]) == 1
    assert previous["tasks"] == previous["criticalTaskIds"] == []
    assert previous["scheduleRevision"] > first["scheduleRevision"]
    task.unlink()
    deleted = asyncio.run(routes.get_project_schedule("project-2"))
    assert deleted["tasks"] == deleted["criticalTaskIds"] == []
    assert deleted["scheduleRevision"] > second["scheduleRevision"]


def test_project_reports_follow_task_reassignment_without_a_schedule_read(planned_vault):
    vault, task = planned_vault
    store = PlanningStore(vault / ".gnosi")
    state = default_state()
    state["resources"] = [normalize_resource({"id": "r1", "name": "Ada", "standard_rate": 10}, {DEFAULT_CALENDAR_ID})]
    state["assignments"] = [normalize_assignment({
        "task_id": "task-1", "resource_id": "r1", "planned_work_hours": 4,
    }, {"r1"})]
    store.save(state)
    assert asyncio.run(routes.get_allocation("project-1"))["total_estimated_cost"] == 40
    task.write_text(task.read_text().replace("[project-1]", "[project-2]"))
    before = task.read_bytes()
    assert asyncio.run(routes.get_allocation("project-1"))["total_estimated_cost"] == 0
    assert asyncio.run(routes.get_allocation("project-2"))["total_estimated_cost"] == 40
    assert task.read_bytes() == before


def test_soft_deleted_task_is_excluded_and_restore_reappears_without_rewriting(planned_vault):
    vault, task = planned_vault
    from backend.api import vault_routes
    from backend.domains.vault.trash.repository import TrashRepository
    from backend.utils.safe_io import safe_write_json
    repository = TrashRepository(
        vault, retention_days=90, parse_frontmatter=vault_routes.parse_frontmatter,
        write_json=safe_write_json,
    )
    before = task.read_bytes()
    assert len(asyncio.run(routes.get_project_schedule("project-1"))["tasks"]) == 1
    repository.move_page("task-1", task)
    assert not task.exists()
    trashed = vault / ".trash" / "task-1" / "page.md"
    assert trashed.read_bytes() == before
    assert asyncio.run(routes.get_project_schedule("project-1"))["tasks"] == []
    repository.restore_page("task-1")
    assert len(asyncio.run(routes.get_project_schedule("project-1"))["tasks"]) == 1
    assert task.read_bytes() == before


def test_task_converted_to_template_leaves_no_scheduled_task(planned_vault):
    vault, task = planned_vault
    assert len(asyncio.run(routes.get_project_schedule("project-1"))["tasks"]) == 1
    task.write_text(task.read_text().replace("title: Task one", "title: Task one\nis_template: true"))
    before = task.read_bytes()
    assert asyncio.run(routes.get_project_schedule("project-1"))["tasks"] == []
    assert task.read_bytes() == before


def test_failed_task_read_preserves_complete_previous_index(planned_vault, monkeypatch):
    vault, task = planned_vault
    refresh_vault_schedules(vault)
    index = ScheduleIndex(vault)
    before = index.path.read_bytes()
    from pathlib import Path
    original = Path.read_text

    def blocked(path, *args, **kwargs):
        if path == task:
            raise PermissionError("Synthetic unavailable task")
        return original(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", blocked)
    with pytest.raises(HTTPException) as error:
        asyncio.run(routes.get_project_schedule("project-1"))
    assert error.value.status_code == 503
    assert index.path.read_bytes() == before


@pytest.fixture()
def project_store(tmp_path, monkeypatch):
    store = PlanningStore(tmp_path / ".gnosi")
    state = default_state()
    resource = normalize_resource({"id": "r1", "name": "Ada", "standard_rate": 10}, {DEFAULT_CALENDAR_ID})
    state["resources"] = [resource]
    state["assignments"] = [normalize_assignment({
        "id": assignment_id, "task_id": task_id, "resource_id": "r1", "project_id": project_id,
        "planned_work_hours": 6, "start": "2026-10-15T09:00", "end": "2026-10-15T17:00",
    }, {"r1"}) for assignment_id, task_id, project_id in [
        ("a1", "task-1", "p1"), ("a2", "task-2", "p2"), ("legacy", "task-3", None),
    ]]
    store.save(state)
    index = {"projects": {
        "p1": {"projectId": "p1", "scheduleRevision": 1, "tasks": [
            {"id": "task-1", "sourceEtag": "etag-1"}, {"id": "task-3", "sourceEtag": "etag-3"},
        ]},
        "p2": {"projectId": "p2", "scheduleRevision": 1, "tasks": [{"id": "task-2"}]},
    }}
    class MemoryIndex:
        def load(self):
            return index
    monkeypatch.setattr(routes, "_store", lambda: store)
    monkeypatch.setattr(routes, "_index", MemoryIndex)
    monkeypatch.setattr(routes, "get_active_vault_path", lambda: None)
    monkeypatch.setattr(routes, "_mutation_lock", asyncio.Lock())
    return store


def test_project_cost_worklogs_and_baselines_exclude_other_projects(project_store):
    async def scenario():
        for task_id in ("task-1", "task-2", "task-3"):
            await routes.create_worklog(routes.WorklogPayload(task_id=task_id, date="2026-10-15", hours=2))
        allocation = await routes.get_allocation("p1")
        assert {item["id"] for item in allocation["assignment_summaries"]} == {"a1", "legacy"}
        assert allocation["total_estimated_cost"] == 120
        assert (await routes.get_allocation())["total_estimated_cost"] == 180
        assert (await routes.get_allocation("missing"))["total_estimated_cost"] == 0
        assert (await routes.list_worklogs(project_id="p1"))["actualHoursByTask"] == {"task-1": 2, "task-3": 2}
        assert (await routes.list_worklogs("task-2", "p1"))["worklogs"] == []
        assert len((await routes.list_worklogs())["worklogs"]) == 3
        baseline = await routes.create_baseline("p1", routes.BaselinePayload(name="Initial", schedule_revision=1))
        assert baseline["baseline"]["allocation"]["total_estimated_cost"] == 120
        variance = await routes.get_baseline_variance("p1", baseline["baseline"]["id"])
        assert variance["totalCostVariance"] == 0
    asyncio.run(scenario())


def test_optional_project_filters_are_honored_over_http(project_store):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.get_workspace_context] = lambda: None
    with TestClient(app) as client:
        assert client.get("/planning/allocation").json()["total_estimated_cost"] == 180
        assert client.get("/planning/allocation?project_id=p1").json()["total_estimated_cost"] == 120
        assert client.get("/planning/allocation?project_id=p2").json()["total_estimated_cost"] == 60
        assert client.get("/planning/worklogs?project_id=p1").json()["worklogs"] == []


def test_project_leveling_considers_shared_load_but_only_changes_owned_assignments(project_store):
    async def scenario():
        before_other = deepcopy(project_store.load()["assignments"][1])
        proposal = await routes.create_leveling_proposal("p1")
        assert proposal["proposals"]
        assert {item["assignment_id"] for item in proposal["proposals"]} <= {"a1", "legacy"}
        result = await routes.apply_leveling_proposal(proposal["id"], routes.ProposalApplyPayload(
            schedule_revision=1, etags=proposal["sourceEtags"],
        ))
        assert {item["assignmentId"] for item in result["updatedAssignments"]} <= {"a1", "legacy"}
        assert project_store.load()["assignments"][1] == before_other
        with pytest.raises(HTTPException) as error:
            await routes.apply_leveling_proposal(proposal["id"], routes.ProposalApplyPayload(
                schedule_revision=1, etags=proposal["sourceEtags"],
            ))
        assert error.value.status_code == 409
    asyncio.run(scenario())


@pytest.mark.parametrize("change", ["foreign", "reassigned", "duplicate"])
def test_legacy_or_stale_leveling_cannot_modify_another_project(project_store, change):
    async def scenario():
        proposal = await routes.create_leveling_proposal("p1")
        if change == "foreign":
            proposal["proposals"].append({**proposal["proposals"][0], "assignment_id": "a2"})
            project_store.append_history(proposal)
        elif change == "duplicate":
            proposal["proposals"].append(deepcopy(proposal["proposals"][0]))
            project_store.append_history(proposal)
        else:
            state = project_store.load()
            state["assignments"][0]["project_id"] = "p2"
            project_store.save(state)
        before = project_store.path.read_bytes()
        with pytest.raises(HTTPException) as error:
            await routes.apply_leveling_proposal(proposal["id"], routes.ProposalApplyPayload(
                schedule_revision=1, etags=proposal["sourceEtags"],
            ))
        assert error.value.status_code == 409
        assert project_store.path.read_bytes() == before
    asyncio.run(scenario())

"""Project-planning read adapter."""

from __future__ import annotations

import json
from typing import Any


def _planning_snapshot() -> dict[str, Any]:
    """Resolve the legacy planning seam lazily for monkeypatch compatibility."""
    from backend.agent import internal_sources

    return internal_sources._planning_snapshot()


def _project_records(
    projects: dict[Any, Any],
    project_ids: set[str],
) -> list[dict[str, Any]]:
    return [
        {
            "id": f"project|{project_id}",
            "entity_type": "project",
            "project_id": str(project_id),
            "title": str(project.get("title") or project_id)[:500],
            "schedule_revision": project.get("scheduleRevision"),
            "diagnostics": list(project.get("diagnostics") or [])[:20],
            "critical_task_ids": list(project.get("criticalTaskIds") or [])[:100],
        }
        for project_id, project in projects.items()
        if not project_ids or str(project_id) in project_ids
    ]


def _task_records(
    projects: dict[Any, Any],
    project_ids: set[str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for project_id, project in projects.items():
        if project_ids and str(project_id) not in project_ids:
            continue
        critical_ids = set(project.get("criticalTaskIds") or [])
        for task in project.get("tasks") or []:
            task_id = str(task.get("id") or "")
            if task_id:
                rows.append(
                    {
                        "id": f"task|{project_id}|{task_id}",
                        "entity_type": "task",
                        "project_id": str(project_id),
                        "task_id": task_id,
                        "title": str(task.get("title") or task_id)[:500],
                        "start": task.get("start"),
                        "end": task.get("end"),
                        "percent_complete": task.get("percentComplete"),
                        "critical": task_id in critical_ids,
                        "source_etag": task.get("sourceEtag"),
                    }
                )
    return rows


def _resource_records(
    resources: list[dict[str, Any]],
    resource_ids: set[str],
    *,
    include_inactive: bool,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for resource in resources:
        resource_id = str(resource.get("id") or "")
        if resource_ids and resource_id not in resource_ids:
            continue
        if not include_inactive and resource.get("active") is False:
            continue
        rows.append(
            {
                **resource,
                "id": f"resource|{resource_id}",
                "entity_type": "resource",
                "rate_history": list(resource.get("rate_history") or [])[:50],
            }
        )
    return rows


def _assignment_records(
    assignments: list[dict[str, Any]],
    project_ids: set[str],
    resource_ids: set[str],
) -> list[dict[str, Any]]:
    return [
        {
            **assignment,
            "id": f"assignment|{assignment.get('id')}",
            "entity_type": "assignment",
        }
        for assignment in assignments
        if (not project_ids or str(assignment.get("project_id") or "") in project_ids)
        and (not resource_ids or str(assignment.get("resource_id") or "") in resource_ids)
    ]


def _planning_records(scope: dict[str, Any]) -> list[dict[str, Any]]:
    snapshot = _planning_snapshot()
    state = snapshot["state"]
    projects = snapshot["schedule"].get("projects") or {}
    entity_types = set(
        scope["entity_types"]
        or ["project", "task", "resource", "assignment", "calendar", "recurrence"]
    )
    project_ids = set(scope["project_ids"])
    resource_ids = set(scope["resource_ids"])
    rows: list[dict[str, Any]] = []

    if "project" in entity_types:
        rows.extend(_project_records(projects, project_ids))
    if "task" in entity_types:
        rows.extend(_task_records(projects, project_ids))
    if "resource" in entity_types:
        rows.extend(
            _resource_records(
                state.get("resources") or [],
                resource_ids,
                include_inactive=bool(scope["include_inactive"]),
            )
        )
    if "assignment" in entity_types:
        rows.extend(_assignment_records(state.get("assignments") or [], project_ids, resource_ids))
    if "calendar" in entity_types:
        rows.extend(
            {
                **calendar,
                "id": f"calendar|{calendar.get('id')}",
                "entity_type": "calendar",
            }
            for calendar in state.get("calendars") or []
        )
    if "recurrence" in entity_types:
        rows.extend(
            {
                **recurrence,
                "id": f"recurrence|{recurrence.get('id')}",
                "entity_type": "recurrence",
            }
            for recurrence in state.get("recurrences") or []
        )
    return rows


def _planning_inventory(scope: dict[str, Any]) -> dict[str, Any]:
    snapshot = _planning_snapshot()
    records = _planning_records(scope)
    counts: dict[str, int] = {}
    for record in records:
        kind = str(record.get("entity_type") or "unknown")
        counts[kind] = counts.get(kind, 0) + 1
    allocation = snapshot["allocation"]
    return {
        "source": "planning",
        "count": len(records),
        "counts": counts,
        "revision": snapshot["state"].get("revision", 0),
        "warning_count": len(allocation.get("warnings") or []),
        "total_estimated_cost": allocation.get("total_estimated_cost", 0),
        "scope": scope,
    }


def _planning_search(scope: dict[str, Any], query_text: str) -> dict[str, Any]:
    term = str(query_text or "").strip().casefold()
    records = _planning_records(scope)
    if term:
        records = [
            record
            for record in records
            if term in json.dumps(record, ensure_ascii=False, default=str).casefold()
        ]
    return {"source": "planning", "query": term, "records": records[: scope["limit"]]}


def _planning_read(scope: dict[str, Any], record_id: str) -> dict[str, Any]:
    record = next(
        (row for row in _planning_records(scope) if row.get("id") == str(record_id)),
        None,
    )
    if record is None:
        raise KeyError(record_id)
    return record

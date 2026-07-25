"""Coalesced, ETag-safe project schedule refreshes triggered by page changes."""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from pathlib import Path
from threading import Lock, Timer
from typing import Any
import json

from backend.services.planning_engine import ScheduleIndex, build_schedule, normalize_period
from backend.services.project_planning import DEFAULT_CALENDAR_ID, PlanningStore


_timers: dict[tuple[str, str], Timer] = {}
_lock = Lock()


def _plugins_state(vault_path: Path) -> dict[str, Any]:
    try:
        return json.loads((vault_path / ".gnosi" / "plugins.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _period_field(metadata: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    for key, value in metadata.items():
        if isinstance(value, dict) and any(name in value for name in ("durationDays", "dependencies", "predecessorIds")):
            return key, value
    return None


def _project_ids(metadata: dict[str, Any], relation_key: str | None) -> list[str]:
    if not relation_key:
        return ["default"]
    raw = metadata.get(relation_key)
    values = raw if isinstance(raw, list) else [raw]
    result = [str(item.get("id") if isinstance(item, dict) else item).strip() for item in values if item]
    return result or ["default"]


def _read_tasks(vault_path: Path, task_table_id: str, relation_key: str | None) -> tuple[dict[str, list[dict[str, Any]]], dict[str, dict[str, Any]]]:
    """Reads the authoritative Markdown facts once for all affected projects."""
    from backend.api.vault_routes import file_etag, parse_frontmatter

    projects: dict[str, list[dict[str, Any]]] = defaultdict(list)
    sources: dict[str, dict[str, Any]] = {}
    for path in vault_path.rglob("*.md"):
        if ".gnosi" in path.parts or ".history" in path.parts:
            continue
        try:
            metadata, _ = parse_frontmatter(path.read_text(encoding="utf-8"), path)
        except OSError:
            continue
        if str(metadata.get("table_id") or metadata.get("database_table_id") or "") != task_table_id:
            continue
        found = _period_field(metadata)
        if not found or not metadata.get("id"):
            continue
        field_name, period = found
        task = {"id": str(metadata["id"]), "title": metadata.get("title") or str(metadata["id"]), "period": period, "etag": file_etag(path)}
        sources[task["id"]] = {"path": path, "metadata": metadata, "field": field_name, "etag": task["etag"]}
        for project_id in _project_ids(metadata, relation_key):
            projects[project_id].append(task)
    return projects, sources


def _write_automatic_boundaries(sources: dict[str, dict[str, Any]], schedule: dict[str, Any]) -> list[dict[str, str]]:
    """Writes only unchanged Markdown facts whose individual boundary is auto."""
    from backend.api.vault_routes import file_etag, save_page_md

    conflicts: list[dict[str, str]] = []
    for calculated in schedule["tasks"]:
        source = sources.get(calculated["id"])
        if not source or file_etag(source["path"]) != source["etag"]:
            conflicts.append({"taskId": calculated["id"], "code": "etag_conflict"})
            continue
        period = normalize_period(source["metadata"].get(source["field"]))
        changed = False
        if period["startMode"] == "automatic" and period["start"] != calculated["start"]:
            period["start"] = calculated["start"]
            changed = True
        if period["endMode"] == "automatic" and period["end"] != calculated["end"]:
            period["end"] = calculated["end"]
            changed = True
        if not changed:
            continue
        metadata = deepcopy(source["metadata"])
        metadata[source["field"]] = period
        try:
            body = source["path"].read_text(encoding="utf-8")
            from backend.api.vault_routes import parse_frontmatter
            _, content = parse_frontmatter(body, source["path"])
            save_page_md(source["path"], metadata, content)
        except OSError:
            conflicts.append({"taskId": calculated["id"], "code": "write_failed"})
    return conflicts


def recalculate_vault(vault_path: Path) -> None:
    """Rebuilds configured task schedules and applies safe automatic boundaries."""
    state = _plugins_state(vault_path)
    if "project-planning" in (state.get("disabled") or []):
        return
    settings = (state.get("settings") or {}).get("project-planning") or {}
    task_table_id = str(settings.get("task_table_id") or "")
    if not task_table_id:
        return
    projects, sources = _read_tasks(vault_path, task_table_id, settings.get("project_relation_field_id"))
    planning = PlanningStore(vault_path / ".gnosi").load()
    calendar = next((item for item in planning["calendars"] if item["id"] == DEFAULT_CALENDAR_ID), planning["calendars"][0])
    index = ScheduleIndex(vault_path)
    for project_id, tasks in projects.items():
        external_tasks = [task for other_project, other_tasks in projects.items() if other_project != project_id for task in other_tasks]
        schedule = build_schedule(tasks, calendar, external_facts=external_tasks)
        schedule["projectId"] = project_id
        schedule["automaticWriteConflicts"] = _write_automatic_boundaries(sources, schedule)
        index.save(project_id, schedule, planning["revision"])


def enqueue_recalculation(vault_path: Path, project_id: str = "all", delay_seconds: float = 0.35) -> None:
    """Coalesces bursts of page writes into a single low-priority refresh."""
    key = (str(vault_path.resolve()), project_id)
    with _lock:
        existing = _timers.pop(key, None)
        if existing:
            existing.cancel()
        timer = Timer(delay_seconds, recalculate_vault, args=(vault_path,))
        timer.daemon = True
        _timers[key] = timer
        timer.start()

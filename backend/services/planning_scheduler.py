"""Coalesced, ETag-safe project schedule refreshes triggered by page changes."""

from __future__ import annotations

from backend.utils.metadata_io import MetadataUnavailable, read_metadata_text

import json
from collections import defaultdict
from copy import deepcopy
from pathlib import Path
from threading import Lock, RLock, Timer
from typing import Any, Protocol, TypedDict, cast

from backend.services import builtin_plugins
from backend.services.planning_engine import ScheduleIndex, build_schedule, normalize_period
from backend.services.project_planning import DEFAULT_CALENDAR_ID, PlanningStore
from backend.services.field_resolver import get_meta_value


_timers: dict[tuple[str, str], Timer] = {}
_lock = Lock()
_refresh_lock = RLock()


class VaultPlanningPort(Protocol):
    """Late-bound Markdown seams retained by the planning scheduler."""

    def file_etag(self, path: Path) -> str | None: ...

    def parse_frontmatter(self, raw: str, path: Path) -> tuple[dict[str, Any], str]: ...

    def save_page_md(self, path: Path, metadata: dict[str, Any], body: str) -> None: ...


class SourceRecord(TypedDict):
    path: Path
    metadata: dict[str, Any]
    field: str
    etag: str | None


def _vault_port() -> VaultPlanningPort:
    from backend.api import vault_routes

    return cast(VaultPlanningPort, vault_routes)


def _plugins_state(vault_path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(read_metadata_text(vault_path / ".gnosi" / "plugins.json", encoding="utf-8"))
        return payload if isinstance(payload, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _period_field(metadata: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    for key, value in metadata.items():
        if isinstance(value, dict) and value.get("kind") in {"point", "period"}:
            return key, value
        if isinstance(value, dict) and any(
            name in value for name in ("durationDays", "dependencies", "predecessorIds")
        ):
            return key, value
    return None


def _task_table(vault_path: Path, table_id: str) -> dict[str, Any]:
    """Read the schema without registry repairs or task mutations."""
    path = vault_path / "BD" / "vault_db_registry.json"
    if not path.exists():
        path = vault_path / "vault_db_registry.json"
    if not path.exists():
        return {}
    registry = json.loads(read_metadata_text(path, encoding="utf-8"))
    if not isinstance(registry, dict) or not isinstance(registry.get("tables", []), list):
        raise ValueError("The planning task schema is unavailable")
    return next((cast(dict[str, Any], table) for table in registry.get("tables", [])
                 if isinstance(table, dict) and table.get("id") == table_id), {})


def _project_ids(
    metadata: dict[str, Any], relation_key: str | None, table: dict[str, Any] | None = None
) -> list[str]:
    if not relation_key:
        return ["default"]
    raw = get_meta_value(metadata, table or {}, relation_key)
    values = raw if isinstance(raw, list) else [raw]
    result = list(dict.fromkeys(
        str(item.get("id") or "" if isinstance(item, dict) else item).strip()
        for item in values if item
    ))
    result = [item for item in result if item]
    return result or ["default"]


def _read_tasks(
    vault_path: Path, task_table_id: str, relation_key: str | None
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, SourceRecord]]:
    """Reads the authoritative Markdown facts once for all affected projects."""
    vault = _vault_port()

    projects: dict[str, list[dict[str, Any]]] = defaultdict(list)
    sources: dict[str, SourceRecord] = {}
    table = _task_table(vault_path, task_table_id) if relation_key else {}
    for path in vault_path.rglob("*.md"):
        if {".gnosi", ".history", ".trash"}.intersection(path.relative_to(vault_path).parts):
            continue
        try:
            metadata, _ = vault.parse_frontmatter(read_metadata_text(path, encoding="utf-8"), path)
        except FileNotFoundError:
            continue
        if (
            str(metadata.get("table_id") or metadata.get("database_table_id") or "")
            != task_table_id
            or metadata.get("is_template") is True
        ):
            continue
        found = _period_field(metadata)
        if not found or not metadata.get("id"):
            continue
        field_name, period = found
        task_id = str(metadata["id"])
        task: dict[str, Any] = {
            "id": task_id,
            "title": metadata.get("title") or task_id,
            "period": period,
            "etag": vault.file_etag(path),
        }
        sources[task_id] = {
            "path": path,
            "metadata": metadata,
            "field": field_name,
            "etag": task["etag"],
        }
        for project_id in _project_ids(metadata, relation_key, table):
            projects[project_id].append(task)
    return projects, sources


def _write_automatic_boundaries(
    sources: dict[str, SourceRecord], schedule: dict[str, Any]
) -> list[dict[str, str]]:
    """Writes only unchanged Markdown facts whose individual boundary is auto."""
    vault = _vault_port()

    conflicts: list[dict[str, str]] = []
    for raw_calculated in schedule["tasks"]:
        calculated = cast(dict[str, Any], raw_calculated)
        task_id = cast(str, calculated["id"])
        source = sources.get(task_id)
        if not source or vault.file_etag(source["path"]) != source["etag"]:
            conflicts.append({"taskId": task_id, "code": "etag_conflict"})
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
        original = source["metadata"].get(source["field"])
        metadata[source["field"]] = {**(original if isinstance(original, dict) else {}), **period}
        try:
            body = read_metadata_text(source["path"], encoding="utf-8")
            _, content = vault.parse_frontmatter(body, source["path"])
            vault.save_page_md(source["path"], metadata, content)
        except OSError:
            conflicts.append({"taskId": task_id, "code": "write_failed"})
    return conflicts


def refresh_vault_schedules(vault_path: Path, *, write_automatic_boundaries: bool = False) -> None:
    """Rebuild all projects; read requests never write task boundaries."""
    with _refresh_lock:
        _refresh_vault_schedules(vault_path, write_automatic_boundaries=write_automatic_boundaries)


def _refresh_vault_schedules(vault_path: Path, *, write_automatic_boundaries: bool) -> None:
    state = _plugins_state(vault_path)
    state, _ = builtin_plugins.normalize_state(state)
    if not builtin_plugins.is_enabled(state, "project-planning"):
        return
    all_settings = state.get("settings")
    raw_settings = all_settings.get("project-planning") if isinstance(all_settings, dict) else None
    settings: dict[str, Any] = raw_settings if isinstance(raw_settings, dict) else {}
    planning = PlanningStore(vault_path / ".gnosi").load()
    task_table_id = str(settings.get("task_table_id") or "")
    if not task_table_id:
        ScheduleIndex(vault_path).replace_all({}, planning["revision"])
        return
    raw_relation_key = settings.get("project_relation_field_id")
    relation_key = str(raw_relation_key) if raw_relation_key else None
    projects, sources = _read_tasks(vault_path, task_table_id, relation_key)
    calendar = next(
        (item for item in planning["calendars"] if item["id"] == DEFAULT_CALENDAR_ID),
        planning["calendars"][0],
    )
    index = ScheduleIndex(vault_path)
    schedules = {}
    for project_id, tasks in projects.items():
        external_tasks = [
            task
            for other_project, other_tasks in projects.items()
            if other_project != project_id
            for task in other_tasks
        ]
        schedule = build_schedule(tasks, calendar, external_facts=external_tasks)
        schedule["projectId"] = project_id
        if write_automatic_boundaries:
            schedule["automaticWriteConflicts"] = _write_automatic_boundaries(sources, schedule)
        schedules[project_id] = schedule
    index.replace_all(schedules, planning["revision"])


def recalculate_vault(vault_path: Path) -> None:
    """Rebuild configured task schedules and apply ETag-safe automatic boundaries."""
    refresh_vault_schedules(vault_path, write_automatic_boundaries=True)


def enqueue_recalculation(
    vault_path: Path, project_id: str = "all", delay_seconds: float = 0.35
) -> None:
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

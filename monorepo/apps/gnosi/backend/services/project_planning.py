"""Vault-scoped storage and pure calculations for project planning resources.

Markdown continues to own task facts.  This module owns the normalized planning
entities that cannot be represented safely as a simple task field: calendars,
resources, and assignments.  The derived allocation report is deliberately
rebuilt from a snapshot on every request.
"""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, time, timedelta
from pathlib import Path
from threading import Lock
from typing import Any
import json
import uuid

from backend.utils.safe_io import safe_write_json


STORE_VERSION = 1
DEFAULT_CALENDAR_ID = "project-default"
_store_lock = Lock()


class PlanningValidationError(ValueError):
    """Raised when normalized planning data violates an invariant."""


def _number(value: Any, field: str, *, minimum: float = 0.0, strict: bool = False) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise PlanningValidationError(f"{field} must be a number") from exc
    if result < minimum or (strict and result <= minimum):
        comparator = "greater than" if strict else "at least"
        raise PlanningValidationError(f"{field} must be {comparator} {minimum}")
    return result


def _iso_day(value: str, field: str) -> str:
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError as exc:
        raise PlanningValidationError(f"{field} must be YYYY-MM-DD") from exc


def _iso_datetime(value: str, field: str) -> datetime:
    try:
        return datetime.fromisoformat(str(value))
    except ValueError as exc:
        raise PlanningValidationError(f"{field} must be an ISO date-time") from exc


def default_state() -> dict[str, Any]:
    """Returns the empty, versioned planning state for one vault."""
    return {
        "version": STORE_VERSION,
        "revision": 0,
        "calendars": [{
            "id": DEFAULT_CALENDAR_ID,
            "name": "Project default",
            "working_weekdays": [1, 2, 3, 4, 5],
            "holidays": [],
            "hours_per_day": 8.0,
            "workday_start": "09:00",
        }],
        "resources": [],
        "assignments": [],
    }


def normalize_calendar(value: dict[str, Any], *, existing_id: str | None = None) -> dict[str, Any]:
    """Validates a named work calendar and returns its canonical representation."""
    calendar_id = existing_id or str(value.get("id") or uuid.uuid4())
    name = str(value.get("name") or "").strip()
    if not name:
        raise PlanningValidationError("calendar name is required")
    weekdays = sorted({int(day) for day in (value.get("working_weekdays") or [])})
    if not weekdays or any(day < 0 or day > 6 for day in weekdays):
        raise PlanningValidationError("working_weekdays must contain weekdays from 0 to 6")
    holidays = sorted({_iso_day(day, "holiday") for day in (value.get("holidays") or [])})
    workday_start = str(value.get("workday_start") or "09:00")
    try:
        time.fromisoformat(workday_start)
    except ValueError as exc:
        raise PlanningValidationError("workday_start must be HH:MM") from exc
    return {
        "id": calendar_id,
        "name": name,
        "working_weekdays": weekdays,
        "holidays": holidays,
        "hours_per_day": _number(value.get("hours_per_day", 8), "hours_per_day", minimum=0, strict=True),
        "workday_start": workday_start[:5],
    }


def normalize_resource(value: dict[str, Any], calendar_ids: set[str], *, existing_id: str | None = None) -> dict[str, Any]:
    """Validates a resource record without coupling it to a task editor."""
    resource_id = existing_id or str(value.get("id") or uuid.uuid4())
    name = str(value.get("name") or "").strip()
    if not name:
        raise PlanningValidationError("resource name is required")
    resource_type = str(value.get("type") or "work")
    if resource_type not in {"work", "material", "cost"}:
        raise PlanningValidationError("resource type must be work, material, or cost")
    calendar_id = str(value.get("calendar_id") or DEFAULT_CALENDAR_ID)
    if resource_type == "work" and calendar_id not in calendar_ids:
        raise PlanningValidationError("resource calendar does not exist")
    return {
        "id": resource_id,
        "name": name,
        "type": resource_type,
        "calendar_id": calendar_id if resource_type == "work" else None,
        "availability_units": _number(value.get("availability_units", 100), "availability_units", minimum=0, strict=True),
        "standard_rate": _number(value.get("standard_rate", 0), "standard_rate"),
        "overtime_rate": _number(value.get("overtime_rate", 0), "overtime_rate"),
        "cost_per_use": _number(value.get("cost_per_use", 0), "cost_per_use"),
        "active": bool(value.get("active", True)),
    }


def normalize_assignment(value: dict[str, Any], resource_ids: set[str], *, existing_id: str | None = None) -> dict[str, Any]:
    """Validates an assignment linked by stable task and resource IDs."""
    assignment_id = existing_id or str(value.get("id") or uuid.uuid4())
    task_id = str(value.get("task_id") or "").strip()
    resource_id = str(value.get("resource_id") or "").strip()
    if not task_id:
        raise PlanningValidationError("task_id is required")
    if resource_id not in resource_ids:
        raise PlanningValidationError("assignment resource does not exist")
    start = value.get("start")
    end = value.get("end")
    normalized_start = _iso_datetime(start, "start").isoformat(timespec="minutes") if start else None
    normalized_end = _iso_datetime(end, "end").isoformat(timespec="minutes") if end else None
    if normalized_start and normalized_end and normalized_end <= normalized_start:
        raise PlanningValidationError("assignment end must be after start")
    return {
        "id": assignment_id,
        "task_id": task_id,
        "resource_id": resource_id,
        "units": _number(value.get("units", 100), "units", minimum=0, strict=True),
        "planned_work_hours": _number(value.get("planned_work_hours", 0), "planned_work_hours"),
        "remaining_work_hours": _number(value.get("remaining_work_hours", value.get("planned_work_hours", 0)), "remaining_work_hours"),
        "actual_work_hours": _number(value.get("actual_work_hours", 0), "actual_work_hours"),
        "rate_override": None if value.get("rate_override") in (None, "") else _number(value.get("rate_override"), "rate_override"),
        "start": normalized_start,
        "end": normalized_end,
    }


def _calendar_is_working(day: date, calendar: dict[str, Any]) -> bool:
    return day.weekday() + 1 in {7 if item == 0 else item for item in calendar["working_weekdays"]} and day.isoformat() not in set(calendar["holidays"])


def _assignment_daily_hours(assignment: dict[str, Any], calendar: dict[str, Any]) -> dict[str, float]:
    """Spreads planned work evenly over the working dates in its explicit range."""
    if not assignment.get("start") or not assignment.get("end") or not assignment["planned_work_hours"]:
        return {}
    start = _iso_datetime(assignment["start"], "start").date()
    end = _iso_datetime(assignment["end"], "end").date()
    days: list[date] = []
    current = start
    while current <= end:
        if _calendar_is_working(current, calendar):
            days.append(current)
        current += timedelta(days=1)
    if not days:
        return {}
    each = assignment["planned_work_hours"] / len(days)
    return {day.isoformat(): each for day in days}


def calculate_allocation(state: dict[str, Any]) -> dict[str, Any]:
    """Derives costs and daily allocation warnings without mutating state.

    Assignments without an explicit time window are retained in the returned
    costs but cannot contribute to a dated capacity warning yet.
    """
    calendars = {item["id"]: item for item in state.get("calendars", [])}
    resources = {item["id"]: item for item in state.get("resources", [])}
    buckets: dict[tuple[str, str], dict[str, Any]] = {}
    assignment_summaries: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    for assignment in state.get("assignments", []):
        resource = resources.get(assignment["resource_id"])
        if not resource:
            continue
        rate = assignment["rate_override"] if assignment.get("rate_override") is not None else resource["standard_rate"]
        cost = assignment["planned_work_hours"] * rate + resource["cost_per_use"]
        assignment_summaries.append({
            "id": assignment["id"], "task_id": assignment["task_id"], "resource_id": resource["id"],
            "planned_work_hours": assignment["planned_work_hours"], "remaining_work_hours": assignment["remaining_work_hours"],
            "actual_work_hours": assignment["actual_work_hours"], "estimated_cost": round(cost, 2),
        })
        if resource["type"] != "work" or not resource.get("active"):
            continue
        calendar = calendars.get(resource.get("calendar_id") or DEFAULT_CALENDAR_ID)
        if not calendar:
            continue
        for day, hours in _assignment_daily_hours(assignment, calendar).items():
            key = (resource["id"], day)
            bucket = buckets.setdefault(key, {
                "resource_id": resource["id"], "resource_name": resource["name"], "date": day,
                "assigned_hours": 0.0,
                "capacity_hours": calendar["hours_per_day"] * resource["availability_units"] / 100,
                "assignment_ids": [],
            })
            bucket["assigned_hours"] += hours
            bucket["assignment_ids"].append(assignment["id"])
    for bucket in buckets.values():
        bucket["assigned_hours"] = round(bucket["assigned_hours"], 2)
        bucket["capacity_hours"] = round(bucket["capacity_hours"], 2)
        bucket["overallocated_hours"] = round(max(0.0, bucket["assigned_hours"] - bucket["capacity_hours"]), 2)
        if bucket["overallocated_hours"]:
            warnings.append({
                "code": "resource_overallocated", "resource_id": bucket["resource_id"], "date": bucket["date"],
                "message": f"{bucket['resource_name']} exceeds capacity by {bucket['overallocated_hours']} h",
                "assignment_ids": bucket["assignment_ids"],
            })
    return {
        "revision": state.get("revision", 0),
        "assignment_summaries": assignment_summaries,
        "buckets": sorted(buckets.values(), key=lambda item: (item["date"], item["resource_name"])),
        "warnings": warnings,
        "total_estimated_cost": round(sum(item["estimated_cost"] for item in assignment_summaries), 2),
    }


class PlanningStore:
    """Atomic vault-scoped store for normalized planning entities."""

    def __init__(self, config_dir: Path):
        self.path = config_dir / "project_planning.json"

    def load(self) -> dict[str, Any]:
        with _store_lock:
            try:
                if not self.path.exists():
                    return default_state()
                value = json.loads(self.path.read_text(encoding="utf-8"))
                if not isinstance(value, dict) or value.get("version") != STORE_VERSION:
                    return default_state()
                state = default_state()
                state.update({key: value.get(key, state[key]) for key in state})
                return state
            except (OSError, json.JSONDecodeError):
                return default_state()

    def save(self, state: dict[str, Any]) -> dict[str, Any]:
        with _store_lock:
            next_state = deepcopy(state)
            next_state["version"] = STORE_VERSION
            next_state["revision"] = int(state.get("revision", 0)) + 1
            self.path.parent.mkdir(parents=True, exist_ok=True)
            safe_write_json(self.path, next_state, indent=2, ensure_ascii=False)
            return next_state

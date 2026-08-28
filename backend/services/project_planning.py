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
from math import ceil
from pathlib import Path
from threading import Lock
from typing import Any, cast
import json
import uuid

from backend.utils.safe_io import safe_write_json


STORE_VERSION = 2
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


def _iso_day(value: object, field: str) -> str:
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
        "calendars": [
            {
                "id": DEFAULT_CALENDAR_ID,
                "name": "Project default",
                "working_weekdays": [1, 2, 3, 4, 5],
                "holidays": [],
                "hours_per_day": 8.0,
                "workday_start": "09:00",
            }
        ],
        "resources": [],
        "assignments": [],
        "recurrences": [],
        "defaults": {"currency": "EUR", "project_relation_field_id": None},
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
        "hours_per_day": _number(
            value.get("hours_per_day", 8), "hours_per_day", minimum=0, strict=True
        ),
        "workday_start": workday_start[:5],
    }


def normalize_resource(
    value: dict[str, Any], calendar_ids: set[str], *, existing_id: str | None = None
) -> dict[str, Any]:
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
        "availability_units": _number(
            value.get("availability_units", 100), "availability_units", minimum=0, strict=True
        ),
        "standard_rate": _number(value.get("standard_rate", 0), "standard_rate"),
        "overtime_rate": _number(value.get("overtime_rate", 0), "overtime_rate"),
        "cost_per_use": _number(value.get("cost_per_use", 0), "cost_per_use"),
        "rate_history": list(value.get("rate_history") or []),
        "active": bool(value.get("active", True)),
    }


def normalize_assignment(
    value: dict[str, Any], resource_ids: set[str], *, existing_id: str | None = None
) -> dict[str, Any]:
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
    normalized_start = (
        _iso_datetime(start, "start").isoformat(timespec="minutes") if start else None
    )
    normalized_end = _iso_datetime(end, "end").isoformat(timespec="minutes") if end else None
    if normalized_start and normalized_end and normalized_end <= normalized_start:
        raise PlanningValidationError("assignment end must be after start")
    task_type = str(value.get("task_type") or "fixed_duration")
    if task_type not in {"fixed_duration", "fixed_work", "fixed_units"}:
        raise PlanningValidationError(
            "task_type must be fixed_duration, fixed_work, or fixed_units"
        )
    return {
        "id": assignment_id,
        "project_id": str(value.get("project_id") or "").strip() or None,
        "task_id": task_id,
        "resource_id": resource_id,
        "units": _number(value.get("units", 100), "units", minimum=0, strict=True),
        "planned_work_hours": _number(value.get("planned_work_hours", 0), "planned_work_hours"),
        "remaining_work_hours": _number(
            value.get("remaining_work_hours", value.get("planned_work_hours", 0)),
            "remaining_work_hours",
        ),
        "actual_work_hours": _number(value.get("actual_work_hours", 0), "actual_work_hours"),
        "rate_override": None
        if value.get("rate_override") in (None, "")
        else _number(value.get("rate_override"), "rate_override"),
        "start": normalized_start,
        "end": normalized_end,
        "task_type": task_type,
        "effort_driven": bool(value.get("effort_driven", False)),
        "overtime_work_hours": _number(value.get("overtime_work_hours", 0), "overtime_work_hours"),
        "material_quantity": _number(value.get("material_quantity", 0), "material_quantity"),
        "fixed_cost": _number(value.get("fixed_cost", 0), "fixed_cost"),
    }


def _calendar_is_working(day: date, calendar: dict[str, Any]) -> bool:
    return day.weekday() + 1 in {
        7 if item == 0 else item for item in calendar["working_weekdays"]
    } and day.isoformat() not in set(calendar["holidays"])


def _assignment_daily_hours(
    assignment: dict[str, Any], calendar: dict[str, Any]
) -> dict[str, float]:
    """Spreads planned work evenly over the working dates in its explicit range."""
    if (
        not assignment.get("start")
        or not assignment.get("end")
        or not assignment["planned_work_hours"]
    ):
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


def _effective_rate(resource: dict[str, Any], assignment: dict[str, Any]) -> float:
    """Resolves an assignment override or the latest rate effective at start."""
    if assignment.get("rate_override") is not None:
        return cast(float, assignment["rate_override"])
    start = str(assignment.get("start") or "9999-12-31")[:10]
    candidates: list[tuple[str, float]] = []
    for item in resource.get("rate_history") or []:
        if not isinstance(item, dict):
            continue
        try:
            effective = _iso_day(item.get("effective_from"), "rate effective_from")
            rate = _number(item.get("standard_rate"), "rate standard_rate")
        except (PlanningValidationError, TypeError):
            continue
        if effective <= start:
            candidates.append((effective, rate))
    return max(candidates, default=("", cast(float, resource["standard_rate"])))[1]


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
        rate = _effective_rate(resource, assignment)
        overtime_cost = assignment.get("overtime_work_hours", 0) * resource.get("overtime_rate", 0)
        material_cost = (
            assignment.get("material_quantity", 0) * rate if resource["type"] == "material" else 0
        )
        cost = (
            assignment["planned_work_hours"] * rate
            + overtime_cost
            + material_cost
            + resource["cost_per_use"]
            + assignment.get("fixed_cost", 0)
        )
        assignment_summaries.append(
            {
                "id": assignment["id"],
                "task_id": assignment["task_id"],
                "resource_id": resource["id"],
                "planned_work_hours": assignment["planned_work_hours"],
                "remaining_work_hours": assignment["remaining_work_hours"],
                "actual_work_hours": assignment["actual_work_hours"],
                "estimated_cost": round(cost, 2),
            }
        )
        if resource["type"] != "work" or not resource.get("active"):
            continue
        calendar = calendars.get(resource.get("calendar_id") or DEFAULT_CALENDAR_ID)
        if not calendar:
            continue
        for day, hours in _assignment_daily_hours(assignment, calendar).items():
            key = (resource["id"], day)
            bucket = buckets.setdefault(
                key,
                {
                    "resource_id": resource["id"],
                    "resource_name": resource["name"],
                    "date": day,
                    "assigned_hours": 0.0,
                    "capacity_hours": calendar["hours_per_day"]
                    * resource["availability_units"]
                    / 100,
                    "assignment_ids": [],
                },
            )
            bucket["assigned_hours"] += hours
            bucket["assignment_ids"].append(assignment["id"])
    for bucket in buckets.values():
        bucket["assigned_hours"] = round(bucket["assigned_hours"], 2)
        bucket["capacity_hours"] = round(bucket["capacity_hours"], 2)
        bucket["overallocated_hours"] = round(
            max(0.0, bucket["assigned_hours"] - bucket["capacity_hours"]), 2
        )
        if bucket["overallocated_hours"]:
            warnings.append(
                {
                    "code": "resource_overallocated",
                    "resource_id": bucket["resource_id"],
                    "date": bucket["date"],
                    "message": f"{bucket['resource_name']} exceeds capacity by {bucket['overallocated_hours']} h",
                    "assignment_ids": bucket["assignment_ids"],
                }
            )
    return {
        "revision": state.get("revision", 0),
        "assignment_summaries": assignment_summaries,
        "buckets": sorted(buckets.values(), key=lambda item: (item["date"], item["resource_name"])),
        "warnings": warnings,
        "total_estimated_cost": round(
            sum(item["estimated_cost"] for item in assignment_summaries), 2
        ),
    }


def _shift_to_next_working_date(value: datetime, calendar: dict[str, Any], days: int) -> datetime:
    """Moves a timestamp by working dates while preserving the local clock time."""
    current = value.date()
    remaining = days
    while remaining:
        current += timedelta(days=1)
        if _calendar_is_working(current, calendar):
            remaining -= 1
    return datetime.combine(current, value.timetz().replace(tzinfo=None))


def propose_leveling(state: dict[str, Any]) -> dict[str, Any]:
    """Creates conservative, non-mutating delay suggestions for overloads.

    The current resource layer has no task constraints, dependencies, or split
    task model yet.  A proposal therefore picks the latest dated assignment in
    an overloaded bucket and moves the whole assignment forward by the minimum
    number of working dates.  The caller must review the proposal before any
    future schedule write is allowed.
    """
    allocation = calculate_allocation(state)
    resources = {item["id"]: item for item in state.get("resources", [])}
    calendars = {item["id"]: item for item in state.get("calendars", [])}
    assignments = {item["id"]: item for item in state.get("assignments", [])}
    proposals: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for warning in allocation["warnings"]:
        candidates = [assignments.get(assignment_id) for assignment_id in warning["assignment_ids"]]
        dated = [item for item in candidates if item and item.get("start") and item.get("end")]
        if not dated:
            continue
        candidate = max(dated, key=lambda item: (item["start"], item["id"]))
        key = (candidate["id"], warning["date"])
        if key in seen:
            continue
        seen.add(key)
        resource = resources.get(candidate["resource_id"])
        calendar = calendars.get((resource or {}).get("calendar_id") or DEFAULT_CALENDAR_ID)
        bucket = next(
            (
                item
                for item in allocation["buckets"]
                if item["resource_id"] == candidate["resource_id"]
                and item["date"] == warning["date"]
            ),
            None,
        )
        if not resource or not calendar or not bucket or bucket["capacity_hours"] <= 0:
            continue
        delay_days = max(1, ceil(bucket["overallocated_hours"] / bucket["capacity_hours"]))
        start = _iso_datetime(candidate["start"], "start")
        end = _iso_datetime(candidate["end"], "end")
        proposals.append(
            {
                "id": f"level-{candidate['id']}-{warning['date']}",
                "assignment_id": candidate["id"],
                "task_id": candidate["task_id"],
                "resource_id": candidate["resource_id"],
                "reason": "resource_overallocated",
                "source_date": warning["date"],
                "delay_working_days": delay_days,
                "source_start": candidate["start"],
                "source_end": candidate["end"],
                "suggested_start": _shift_to_next_working_date(
                    start, calendar, delay_days
                ).isoformat(timespec="minutes"),
                "suggested_end": _shift_to_next_working_date(end, calendar, delay_days).isoformat(
                    timespec="minutes"
                ),
                "requires_review": True,
            }
        )
    return {
        "revision": state.get("revision", 0),
        "warnings": allocation["warnings"],
        "proposals": proposals,
        "automatic_apply_supported": False,
    }


class PlanningStore:
    """Atomic vault-scoped store for normalized planning entities."""

    def __init__(self, config_dir: Path):
        self.path = config_dir / "project_planning.json"
        self.history_path = config_dir / "project_planning_history.jsonl"

    def load(self) -> dict[str, Any]:
        with _store_lock:
            try:
                if not self.path.exists():
                    return default_state()
                value = json.loads(self.path.read_text(encoding="utf-8"))
                if not isinstance(value, dict):
                    return default_state()
                if value.get("version") not in {1, STORE_VERSION}:
                    return default_state()
                state = default_state()
                state.update({key: value.get(key, state[key]) for key in state})
                state["version"] = STORE_VERSION
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

    def append_history(self, entry: dict[str, Any]) -> None:
        """Appends an auditable event without changing previous records."""
        with _store_lock:
            self.history_path.parent.mkdir(parents=True, exist_ok=True)
            with self.history_path.open("a", encoding="utf-8") as output:
                output.write(json.dumps(entry, ensure_ascii=False, sort_keys=True) + "\n")

    def history(self, event_type: str | None = None) -> list[dict[str, Any]]:
        with _store_lock:
            if not self.history_path.exists():
                return []
            result = []
            for line in self.history_path.read_text(encoding="utf-8").splitlines():
                try:
                    value = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not event_type or value.get("type") == event_type:
                    result.append(value)
            return result

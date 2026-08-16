"""Deterministic, rebuildable scheduling for Gnosi project planning.

The engine is deliberately independent from FastAPI and Markdown I/O. Callers
pass task facts and a normalized calendar, then decide whether an automatic
result may be persisted after checking their own page ETags.
"""

from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
from typing import Any


DEPENDENCY_TYPES = {"FS", "SS", "FF", "SF"}
CONSTRAINT_TYPES = {"ASAP", "ALAP", "SNET", "SNLT", "FNET", "FNLT", "MSO", "MFO"}


def parse_datetime(value: Any) -> datetime | None:
    """Parses an ISO boundary without imposing a timezone policy."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def normalize_period(value: Any) -> dict[str, Any]:
    """Returns v3 period data while accepting v1/v2 persisted values."""
    source = value if isinstance(value, dict) else {}
    legacy = source.get("predecessorIds") or ([] if not source.get("predecessorId") else [source["predecessorId"]])
    dependencies = source.get("dependencies")
    if not isinstance(dependencies, list):
        dependencies = [{"predecessorId": item, "type": "FS", "lagMinutes": 0} for item in legacy]
    normalized_dependencies = []
    for dependency in dependencies:
        if not isinstance(dependency, dict) or not str(dependency.get("predecessorId") or "").strip():
            continue
        kind = str(dependency.get("type") or "FS").upper()
        normalized_dependencies.append({
            "predecessorId": str(dependency["predecessorId"]),
            "type": kind if kind in DEPENDENCY_TYPES else "FS",
            "lagMinutes": float(dependency.get("lagMinutes") or 0),
        })
    mode = str(source.get("mode") or "automatic").lower()
    return {
        "version": 3,
        "start": source.get("start"), "end": source.get("end"),
        "durationDays": max(0.0, float(source.get("durationDays") or 0)),
        "durationValue": max(0.0, float(source["durationValue"])) if source.get("durationValue") is not None else None,
        "durationUnit": str(source.get("durationUnit") or "") if str(source.get("durationUnit") or "") in {"hours", "days", "years"} else None,
        "startMode": "manual" if source.get("startMode") == "manual" else "automatic",
        "endMode": "manual" if source.get("endMode") == "manual" else "automatic",
        "dependencies": normalized_dependencies,
        "mode": "manual" if mode == "manual" else "automatic",
        "constraintType": str(source.get("constraintType") or "ASAP").upper(),
        "constraintDate": source.get("constraintDate"), "deadline": source.get("deadline"),
        "percentComplete": min(100.0, max(0.0, float(source.get("percentComplete") or 0))),
        "actualStart": source.get("actualStart"), "actualEnd": source.get("actualEnd"),
    }


@dataclass(frozen=True)
class WorkingCalendar:
    """Minimal work calendar used by the calculation engine."""
    weekdays: frozenset[int]
    holidays: frozenset[str]
    hours_per_day: float

    @classmethod
    def from_dict(cls, value: dict[str, Any] | None) -> "WorkingCalendar":
        value = value or {}
        days = value.get("working_weekdays") or [1, 2, 3, 4, 5]
        return cls(frozenset((int(day) - 1) % 7 for day in days), frozenset(value.get("holidays") or []), float(value.get("hours_per_day") or 8))

    def is_working(self, instant: datetime) -> bool:
        return instant.weekday() in self.weekdays and instant.date().isoformat() not in self.holidays

    def add_working_minutes(self, instant: datetime, minutes: float) -> datetime:
        """Moves in working-day units while preserving the local clock.

        Intraday shift support is represented in minutes; calendar working hours
        are intentionally not fabricated when only hours-per-day is configured.
        """
        if not minutes:
            return instant
        direction = 1 if minutes > 0 else -1
        remaining = abs(minutes)
        current = instant
        while remaining:
            chunk = min(remaining, self.hours_per_day * 60)
            if chunk == self.hours_per_day * 60:
                current += timedelta(days=direction)
            else:
                current += timedelta(minutes=direction * chunk)
            remaining -= chunk
            while not self.is_working(current):
                current += timedelta(days=direction)
        return current

    def add_duration(self, instant: datetime, days: float) -> datetime:
        direction = 1 if days >= 0 else -1
        current = instant + timedelta(hours=days * self.hours_per_day)
        while not self.is_working(current):
            current += timedelta(days=direction)
        return current


def _add_period_duration(calendar: WorkingCalendar, instant: datetime, period: dict[str, Any], direction: int = 1) -> datetime:
    """Adds a configured period duration while retaining legacy day support."""
    raw_value = period.get("durationValue")
    value = float(raw_value) if raw_value is not None else float(period.get("durationDays") or 0)
    value *= direction
    unit = period.get("durationUnit") or "days"
    if unit == "years":
        whole_years = int(value)
        fractional_years = value - whole_years
        target_year = instant.year + whole_years
        try:
            result = instant.replace(year=target_year)
        except ValueError:
            # Preserve leap-day periods when the target year is not a leap year.
            result = instant.replace(year=target_year, day=28)
        if fractional_years:
            result += timedelta(days=fractional_years * 365)
        return result
    if unit == "hours":
        return calendar.add_working_minutes(instant, value * 60)
    return calendar.add_duration(instant, value)


def _topological_order(tasks: dict[str, dict[str, Any]]) -> tuple[list[str], list[list[str]]]:
    outgoing: dict[str, list[str]] = defaultdict(list)
    incoming = {task_id: 0 for task_id in tasks}
    for task_id, task in tasks.items():
        for dep in task["period"]["dependencies"]:
            predecessor = dep["predecessorId"]
            if predecessor in tasks:
                outgoing[predecessor].append(task_id)
                incoming[task_id] += 1
    queue = deque(sorted(key for key, degree in incoming.items() if degree == 0))
    order: list[str] = []
    while queue:
        task_id = queue.popleft()
        order.append(task_id)
        for successor in outgoing[task_id]:
            incoming[successor] -= 1
            if incoming[successor] == 0:
                queue.append(successor)
    cycle_nodes = sorted(set(tasks) - set(order))
    return order, [cycle_nodes] if cycle_nodes else []


def _apply_dependency(candidate: datetime, predecessor: dict[str, Any], dependency: dict[str, Any], period: dict[str, Any], calendar: WorkingCalendar) -> datetime:
    lag = float(dependency.get("lagMinutes") or 0)
    kind = dependency["type"]
    pred_start, pred_end = predecessor["start"], predecessor["end"]
    if kind == "FS":
        return calendar.add_working_minutes(pred_end, lag)
    if kind == "SS":
        return calendar.add_working_minutes(pred_start, lag)
    if kind == "FF":
        return _add_period_duration(calendar, calendar.add_working_minutes(pred_end, lag), period, -1)
    return _add_period_duration(calendar, calendar.add_working_minutes(pred_start, lag), period, -1)


def _backward_bound(successor: dict[str, Any], dependency: dict[str, Any], predecessor_duration: float, calendar: WorkingCalendar) -> tuple[str, datetime]:
    """Returns the predecessor boundary constrained by one successor link."""
    lag = float(dependency.get("lagMinutes") or 0)
    kind = dependency["type"]
    if kind == "FS":
        return "end", calendar.add_working_minutes(successor["lateStart"], -lag)
    if kind == "SS":
        return "start", calendar.add_working_minutes(successor["lateStart"], -lag)
    if kind == "FF":
        return "end", calendar.add_working_minutes(successor["lateEnd"], -lag)
    return "start", calendar.add_working_minutes(successor["lateEnd"], -lag)


def build_schedule(task_facts: list[dict[str, Any]], calendar_data: dict[str, Any] | None = None, *, status_date: str | None = None, external_facts: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Calculates dates, diagnostics, slack and critical tasks for a task graph."""
    calendar = WorkingCalendar.from_dict(calendar_data)
    tasks: dict[str, dict[str, Any]] = {}
    diagnostics: list[dict[str, Any]] = []
    requested_ids = {str(item.get("id") or "") for item in task_facts}
    for item in [*(external_facts or []), *task_facts]:
        task_id = str(item.get("id") or "")
        if not task_id:
            continue
        tasks[task_id] = {**item, "period": normalize_period(item.get("period"))}
    order, cycles = _topological_order(tasks)
    for nodes in cycles:
        diagnostics.append({"code": "dependency_cycle", "severity": "error", "taskIds": nodes, "message": "Dependency cycle prevents scheduling"})
    calculated: dict[str, dict[str, Any]] = {}
    epoch = parse_datetime(status_date) or datetime.now().replace(second=0, microsecond=0)
    for task_id in order:
        task = tasks[task_id]
        period = task["period"]
        duration = period["durationDays"]
        actual_start = parse_datetime(period["actualStart"])
        actual_end = parse_datetime(period["actualEnd"])
        start = actual_start or (parse_datetime(period["start"]) if period["startMode"] == "manual" else None)
        trace: list[str] = []
        candidate = epoch
        for dependency in period["dependencies"]:
            predecessor = calculated.get(dependency["predecessorId"])
            if predecessor:
                candidate = max(candidate, _apply_dependency(candidate, predecessor, dependency, period, calendar))
                trace.append(f"{dependency['type']} {dependency['predecessorId']}")
            elif dependency["predecessorId"] not in tasks:
                diagnostics.append({"code": "external_dependency", "severity": "warning", "taskId": task_id, "message": f"External predecessor {dependency['predecessorId']} is unavailable"})
        constraint = period["constraintType"]
        constraint_date = parse_datetime(period["constraintDate"])
        if constraint in {"SNET", "MSO"} and constraint_date:
            candidate = max(candidate, constraint_date)
        if start is None:
            start = candidate
        end = actual_end or (parse_datetime(period["end"]) if period["endMode"] == "manual" else None)
        if end is None:
            end = _add_period_duration(calendar, start, period)
        if constraint == "FNET" and constraint_date and end < constraint_date:
            end = constraint_date
            start = _add_period_duration(calendar, end, period, -1)
        if constraint == "MFO" and constraint_date:
            end = constraint_date
            start = _add_period_duration(calendar, end, period, -1)
        if constraint in {"SNLT", "FNLT"} and constraint_date and ((constraint == "SNLT" and start > constraint_date) or (constraint == "FNLT" and end > constraint_date)):
            diagnostics.append({"code": "constraint_violation", "severity": "warning", "taskId": task_id, "message": f"{constraint} cannot be met"})
        deadline = parse_datetime(period["deadline"])
        if deadline and end > deadline:
            diagnostics.append({"code": "deadline_missed", "severity": "warning", "taskId": task_id, "message": "Deadline is missed"})
        calculated[task_id] = {"id": task_id, "title": task.get("title") or task_id, "start": start, "end": end, "durationDays": duration, "percentComplete": period["percentComplete"], "actualStart": period["actualStart"], "actualEnd": period["actualEnd"], "trace": trace, "sourceEtag": task.get("etag"), "period": period}
    finish = max((item["end"] for item in calculated.values()), default=epoch)
    successors: dict[str, list[tuple[str, dict[str, Any]]]] = defaultdict(list)
    for successor_id, task in tasks.items():
        for dependency in task["period"]["dependencies"]:
            if dependency["predecessorId"] in calculated:
                successors[dependency["predecessorId"]].append((successor_id, dependency))
    for task_id in reversed(order):
        task = calculated[task_id]
        late_start = _add_period_duration(calendar, finish, task["period"], -1)
        late_end = finish
        for successor_id, dependency in successors[task_id]:
            successor = calculated[successor_id]
            boundary, value = _backward_bound(successor, dependency, task["durationDays"], calendar)
            if boundary == "start":
                late_start = min(late_start, value)
                late_end = _add_period_duration(calendar, late_start, task["period"])
            else:
                late_end = min(late_end, value)
                late_start = _add_period_duration(calendar, late_end, task["period"], -1)
        task["lateStart"] = late_start
        task["lateEnd"] = late_end
        task["freeSlackMinutes"] = round((late_start - task["start"]).total_seconds() / 60, 2)
        task["critical"] = task["freeSlackMinutes"] <= 0
        if task["period"]["constraintType"] == "ALAP" and task["period"]["startMode"] == "automatic" and not task["actualStart"]:
            task["start"] = late_start
            if task["period"]["endMode"] == "automatic" and not task["actualEnd"]:
                task["end"] = late_end
    visible_tasks = [item for item in calculated.values() if item["id"] in requested_ids]
    return {"scheduleRevision": None, "generatedAt": datetime.now().isoformat(timespec="seconds"), "tasks": [{**item, "start": item["start"].isoformat(timespec="minutes"), "end": item["end"].isoformat(timespec="minutes"), "lateStart": item["lateStart"].isoformat(timespec="minutes"), "lateEnd": item["lateEnd"].isoformat(timespec="minutes"), "period": None} for item in visible_tasks], "diagnostics": diagnostics, "criticalTaskIds": [item["id"] for item in visible_tasks if item["critical"]], "cycles": cycles}


class ScheduleIndex:
    """Stores only rebuildable schedule results outside the synced vault."""

    def __init__(self, vault_path: Path):
        root = Path(os.environ.get("GNOSI_LOCAL_DATA") or "/app/data") / "cache" / "planning"
        fingerprint = hashlib.sha256(str(vault_path.resolve()).encode()).hexdigest()[:24]
        self.path = root / f"{fingerprint}.json"

    def load(self) -> dict[str, Any] | None:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None

    def save(self, project_id: str, schedule: dict[str, Any], planning_revision: int) -> dict[str, Any]:
        current = self.load() or {"projects": {}}
        projects = current.setdefault("projects", {})
        previous = projects.get(project_id) or {}
        schedule["scheduleRevision"] = int(previous.get("scheduleRevision", 0)) + 1
        schedule["planningRevision"] = planning_revision
        projects[project_id] = schedule
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(self.path)
        return schedule

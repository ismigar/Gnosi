"""API for normalized project-planning resources and allocation reports."""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.services.project_planning import (
    DEFAULT_CALENDAR_ID,
    PlanningStore,
    PlanningValidationError,
    calculate_allocation,
    propose_leveling,
    normalize_assignment,
    normalize_calendar,
    normalize_resource,
)
from backend.services.planning_engine import ScheduleIndex, build_schedule
from backend.services.context_vars import get_active_vault_path
from backend.services.workspace_service import get_workspace_context, require_role


router = APIRouter(dependencies=[Depends(get_workspace_context)])
_mutation_lock = asyncio.Lock()


class CalendarPayload(BaseModel):
    name: Optional[str] = None
    working_weekdays: Optional[list[int]] = None
    holidays: Optional[list[str]] = None
    hours_per_day: Optional[float] = None
    workday_start: Optional[str] = None


class ResourcePayload(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    calendar_id: Optional[str] = None
    availability_units: Optional[float] = None
    standard_rate: Optional[float] = None
    overtime_rate: Optional[float] = None
    cost_per_use: Optional[float] = None
    active: Optional[bool] = None
    rate_history: Optional[list[dict]] = None


class AssignmentPayload(BaseModel):
    task_id: Optional[str] = None
    resource_id: Optional[str] = None
    units: Optional[float] = None
    planned_work_hours: Optional[float] = None
    remaining_work_hours: Optional[float] = None
    actual_work_hours: Optional[float] = None
    rate_override: Optional[float] = None
    start: Optional[str] = None
    end: Optional[str] = None
    task_type: Optional[str] = None
    effort_driven: Optional[bool] = None
    overtime_work_hours: Optional[float] = None
    material_quantity: Optional[float] = None
    fixed_cost: Optional[float] = None


class TaskFactPayload(BaseModel):
    id: str
    title: Optional[str] = None
    period: dict = {}
    etag: Optional[str] = None


class RecalculatePayload(BaseModel):
    tasks: list[TaskFactPayload] = []
    status_date: Optional[str] = None


class BaselinePayload(BaseModel):
    name: str
    schedule_revision: Optional[int] = None


class WorklogPayload(BaseModel):
    task_id: str
    resource_id: Optional[str] = None
    date: str
    hours: float
    correction_of: Optional[str] = None


class RecurrencePayload(BaseModel):
    task_id: str
    rrule: str
    exdates: list[str] = []


class ProposalApplyPayload(BaseModel):
    schedule_revision: int
    etags: dict[str, str] = {}


def _payload(value: BaseModel) -> dict:
    if hasattr(value, "model_dump"):
        return value.model_dump(exclude_none=True)
    return value.dict(exclude_none=True)


def _store() -> PlanningStore:
    return PlanningStore(Path(get_active_vault_path()) / ".gnosi")


def _index() -> ScheduleIndex:
    return ScheduleIndex(Path(get_active_vault_path()))


def _not_found(kind: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"{kind} not found")


def _validation_error(error: PlanningValidationError) -> HTTPException:
    return HTTPException(status_code=422, detail=str(error))


@router.get("/planning/state")
async def get_planning_state():
    """Returns source entities plus a derived allocation snapshot."""
    state = await asyncio.to_thread(_store().load)
    return {**state, "allocation": calculate_allocation(state)}


@router.get("/planning/allocation")
async def get_allocation():
    """Returns a rebuildable allocation/cost report without writing task data."""
    state = await asyncio.to_thread(_store().load)
    return calculate_allocation(state)


@router.get("/planning/leveling/proposal")
async def get_leveling_proposal():
    """Returns review-only delay suggestions; it never changes task dates."""
    state = await asyncio.to_thread(_store().load)
    return propose_leveling(state)


@router.get("/planning/projects/{project_id}/schedule")
async def get_project_schedule(project_id: str):
    """Returns the cached, reconstructible schedule for one project."""
    schedule = await asyncio.to_thread(_index().load)
    return ((schedule or {}).get("projects") or {}).get(project_id) or {
        "projectId": project_id, "tasks": [], "diagnostics": [], "criticalTaskIds": [], "scheduleRevision": 0,
    }


@router.post("/planning/projects/{project_id}/recalculate", dependencies=[Depends(require_role("editor"))])
async def recalculate_project(project_id: str, payload: RecalculatePayload):
    """Rebuilds a project schedule from caller-provided Markdown task facts.

    Persisting automatic boundaries is deliberately handled by the page writer,
    which owns ETag checks. This endpoint has no authority to overwrite Markdown.
    """
    state = await asyncio.to_thread(_store().load)
    calendar = next((item for item in state["calendars"] if item["id"] == DEFAULT_CALENDAR_ID), state["calendars"][0])
    schedule = await asyncio.to_thread(build_schedule, [_payload(task) for task in payload.tasks], calendar, status_date=payload.status_date)
    schedule["projectId"] = project_id
    schedule = await asyncio.to_thread(_index().save, project_id, schedule, state["revision"])
    return schedule


@router.post("/planning/projects/{project_id}/baselines", dependencies=[Depends(require_role("editor"))])
async def create_baseline(project_id: str, payload: BaselinePayload):
    """Captures an immutable named schedule snapshot in append-only history."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="baseline name is required")
    schedule = ((await asyncio.to_thread(_index().load) or {}).get("projects") or {}).get(project_id)
    if not schedule:
        raise HTTPException(status_code=409, detail="Recalculate the project before creating a baseline")
    if payload.schedule_revision is not None and payload.schedule_revision != schedule.get("scheduleRevision"):
        raise HTTPException(status_code=409, detail="Schedule revision is stale")
    store = _store()
    existing = await asyncio.to_thread(store.history, "baseline")
    if any(item.get("projectId") == project_id and item.get("name") == name for item in existing):
        raise HTTPException(status_code=409, detail="Baseline name already exists")
    baseline = {"id": str(uuid.uuid4()), "type": "baseline", "projectId": project_id, "name": name, "createdAt": datetime.now().isoformat(timespec="seconds"), "scheduleRevision": schedule["scheduleRevision"], "schedule": schedule}
    await asyncio.to_thread(store.append_history, baseline)
    return {"baseline": baseline}


@router.get("/planning/projects/{project_id}/baselines")
async def list_baselines(project_id: str):
    return {"baselines": [item for item in await asyncio.to_thread(_store().history, "baseline") if item.get("projectId") == project_id]}


@router.get("/planning/projects/{project_id}/baselines/{baseline_id}/variance")
async def get_baseline_variance(project_id: str, baseline_id: str):
    """Compares the current derived schedule with an immutable baseline."""
    baselines = await asyncio.to_thread(_store().history, "baseline")
    baseline = next((item for item in baselines if item.get("id") == baseline_id and item.get("projectId") == project_id), None)
    if not baseline:
        raise _not_found("baseline")
    current = ((await asyncio.to_thread(_index().load) or {}).get("projects") or {}).get(project_id)
    if not current:
        raise HTTPException(status_code=409, detail="Recalculate the project before requesting variance")
    original_tasks = {item["id"]: item for item in baseline["schedule"].get("tasks", [])}
    current_tasks = {item["id"]: item for item in current.get("tasks", [])}
    rows = []
    for task_id in sorted(set(original_tasks) | set(current_tasks)):
        original = original_tasks.get(task_id) or {}
        revised = current_tasks.get(task_id) or {}
        rows.append({
            "taskId": task_id,
            "baselineStart": original.get("start"), "currentStart": revised.get("start"),
            "baselineEnd": original.get("end"), "currentEnd": revised.get("end"),
            "durationDaysVariance": round(float(revised.get("durationDays") or 0) - float(original.get("durationDays") or 0), 4),
        })
    return {"baselineId": baseline_id, "baselineScheduleRevision": baseline.get("scheduleRevision"), "currentScheduleRevision": current.get("scheduleRevision"), "tasks": rows}


@router.post("/planning/worklogs", dependencies=[Depends(require_role("editor"))])
async def create_worklog(payload: WorklogPayload):
    if payload.hours == 0:
        raise HTTPException(status_code=422, detail="worklog hours cannot be zero")
    entry = {"id": str(uuid.uuid4()), "type": "worklog", "taskId": payload.task_id, "resourceId": payload.resource_id, "date": payload.date, "hours": payload.hours, "correctionOf": payload.correction_of, "createdAt": datetime.now().isoformat(timespec="seconds")}
    await asyncio.to_thread(_store().append_history, entry)
    return {"worklog": entry}


@router.get("/planning/worklogs")
async def list_worklogs(task_id: Optional[str] = None):
    entries = await asyncio.to_thread(_store().history, "worklog")
    if task_id:
        entries = [entry for entry in entries if entry.get("taskId") == task_id]
    return {"worklogs": entries}


@router.post("/planning/projects/{project_id}/leveling/proposals")
async def create_leveling_proposal(project_id: str):
    state = await asyncio.to_thread(_store().load)
    schedule = ((await asyncio.to_thread(_index().load) or {}).get("projects") or {}).get(project_id)
    proposal = propose_leveling(state)
    proposal.update({"id": str(uuid.uuid4()), "projectId": project_id, "scheduleRevision": (schedule or {}).get("scheduleRevision", 0), "createdAt": datetime.now().isoformat(timespec="seconds")})
    proposal["type"] = "leveling_proposal"
    proposal["status"] = "pending"
    proposal["sourceEtags"] = {item["id"]: item.get("sourceEtag") for item in (schedule or {}).get("tasks", []) if item.get("sourceEtag")}
    await asyncio.to_thread(_store().append_history, proposal)
    return proposal


@router.post("/planning/leveling/proposals/{proposal_id}/apply", dependencies=[Depends(require_role("editor"))])
async def apply_leveling_proposal(proposal_id: str, payload: ProposalApplyPayload):
    """Accepts a current proposal only after revision and ETag validation."""
    store = _store()
    proposals = await asyncio.to_thread(store.history, "leveling_proposal")
    proposal = next((item for item in reversed(proposals) if item.get("id") == proposal_id), None)
    if not proposal:
        raise _not_found("leveling proposal")
    if proposal.get("status") != "pending":
        raise HTTPException(status_code=409, detail="Leveling proposal has already been decided")
    if payload.schedule_revision != proposal.get("scheduleRevision"):
        raise HTTPException(status_code=409, detail="Schedule revision is stale; regenerate the proposal")
    schedule = ((await asyncio.to_thread(_index().load) or {}).get("projects") or {}).get(proposal["projectId"])
    if not schedule or schedule.get("scheduleRevision") != proposal.get("scheduleRevision"):
        raise HTTPException(status_code=409, detail="Schedule changed; regenerate the proposal")
    current_etags = {item["id"]: item.get("sourceEtag") for item in schedule.get("tasks", []) if item.get("sourceEtag")}
    expected_etags = proposal.get("sourceEtags") or {}
    if current_etags != expected_etags or payload.etags != expected_etags:
        raise HTTPException(status_code=409, detail="Task ETags changed; regenerate the proposal")
    state = await asyncio.to_thread(store.load)
    by_assignment = {item["id"]: item for item in state["assignments"]}
    applied_changes = []
    for change in proposal["proposals"]:
        assignment = by_assignment.get(change["assignment_id"])
        if not assignment:
            raise HTTPException(status_code=409, detail="An assignment in the proposal no longer exists")
        if assignment.get("start") != change.get("source_start", assignment.get("start")) or assignment.get("end") != change.get("source_end", assignment.get("end")):
            raise HTTPException(status_code=409, detail="An assignment changed; regenerate the proposal")
        assignment["start"] = change["suggested_start"]
        assignment["end"] = change["suggested_end"]
        applied_changes.append({"assignmentId": assignment["id"], "start": assignment["start"], "end": assignment["end"]})
    if applied_changes:
        await asyncio.to_thread(store.save, state)
    entry = {"id": str(uuid.uuid4()), "type": "leveling_decision", "proposalId": proposal_id, "scheduleRevision": payload.schedule_revision, "etags": payload.etags, "acceptedAt": datetime.now().isoformat(timespec="seconds"), "appliedChanges": applied_changes}
    await asyncio.to_thread(_store().append_history, entry)
    await asyncio.to_thread(store.append_history, {**proposal, "status": "accepted", "decidedAt": entry["acceptedAt"]})
    return {"decision": entry, "automaticWrites": [], "updatedAssignments": applied_changes}


@router.post("/planning/recurrences", dependencies=[Depends(require_role("editor"))])
async def create_recurrence(payload: RecurrencePayload):
    """Stores an RRULE declaration; materialization always creates stable tasks."""
    recurrence = {"id": str(uuid.uuid4()), **_payload(payload)}
    async with _mutation_lock:
        store = _store()
        state = await asyncio.to_thread(store.load)
        state["recurrences"].append(recurrence)
        state = await asyncio.to_thread(store.save, state)
    return {"recurrence": recurrence, "revision": state["revision"]}


@router.post("/planning/recurrences/{recurrence_id}/materialize", dependencies=[Depends(require_role("editor"))])
async def materialize_recurrence(recurrence_id: str):
    """Returns a reviewed materialization instruction without editing Markdown.

    Page creation stays with the vault writer so generated tasks receive normal
    page IDs and ETags; each is marked with this immutable origin identifier.
    """
    state = await asyncio.to_thread(_store().load)
    recurrence = next((item for item in state["recurrences"] if item["id"] == recurrence_id), None)
    if not recurrence:
        raise _not_found("recurrence")
    return {"recurrence": recurrence, "materialization": {"recurrenceOriginId": recurrence_id, "sourceTaskId": recurrence["task_id"], "requiresPageWriter": True}}


@router.post("/planning/calendars", dependencies=[Depends(require_role("editor"))])
async def create_calendar(payload: CalendarPayload):
    data = _payload(payload)
    try:
        calendar = normalize_calendar(data)
    except PlanningValidationError as error:
        raise _validation_error(error) from error
    async with _mutation_lock:
        store = _store()
        state = await asyncio.to_thread(store.load)
        state["calendars"].append(calendar)
        state = await asyncio.to_thread(store.save, state)
    return {"calendar": calendar, "revision": state["revision"]}


@router.patch("/planning/calendars/{calendar_id}", dependencies=[Depends(require_role("editor"))])
async def update_calendar(calendar_id: str, payload: CalendarPayload):
    async with _mutation_lock:
        store = _store()
        state = await asyncio.to_thread(store.load)
        current = next((item for item in state["calendars"] if item["id"] == calendar_id), None)
        if not current:
            raise _not_found("calendar")
        try:
            calendar = normalize_calendar({**current, **_payload(payload)}, existing_id=calendar_id)
        except PlanningValidationError as error:
            raise _validation_error(error) from error
        state["calendars"] = [calendar if item["id"] == calendar_id else item for item in state["calendars"]]
        state = await asyncio.to_thread(store.save, state)
    return {"calendar": calendar, "revision": state["revision"]}


@router.delete("/planning/calendars/{calendar_id}", dependencies=[Depends(require_role("editor"))])
async def delete_calendar(calendar_id: str):
    if calendar_id == DEFAULT_CALENDAR_ID:
        raise HTTPException(status_code=409, detail="The project default calendar cannot be deleted")
    async with _mutation_lock:
        store = _store()
        state = await asyncio.to_thread(store.load)
        if not any(item["id"] == calendar_id for item in state["calendars"]):
            raise _not_found("calendar")
        if any(item.get("calendar_id") == calendar_id for item in state["resources"]):
            raise HTTPException(status_code=409, detail="A resource still uses this calendar")
        state["calendars"] = [item for item in state["calendars"] if item["id"] != calendar_id]
        state = await asyncio.to_thread(store.save, state)
    return {"deleted": calendar_id, "revision": state["revision"]}


@router.post("/planning/resources", dependencies=[Depends(require_role("editor"))])
async def create_resource(payload: ResourcePayload):
    async with _mutation_lock:
        store = _store()
        state = await asyncio.to_thread(store.load)
        try:
            resource = normalize_resource(_payload(payload), {item["id"] for item in state["calendars"]})
        except PlanningValidationError as error:
            raise _validation_error(error) from error
        state["resources"].append(resource)
        state = await asyncio.to_thread(store.save, state)
    return {"resource": resource, "revision": state["revision"]}


@router.patch("/planning/resources/{resource_id}", dependencies=[Depends(require_role("editor"))])
async def update_resource(resource_id: str, payload: ResourcePayload):
    async with _mutation_lock:
        store = _store()
        state = await asyncio.to_thread(store.load)
        current = next((item for item in state["resources"] if item["id"] == resource_id), None)
        if not current:
            raise _not_found("resource")
        try:
            resource = normalize_resource(
                {**current, **_payload(payload)},
                {item["id"] for item in state["calendars"]},
                existing_id=resource_id,
            )
        except PlanningValidationError as error:
            raise _validation_error(error) from error
        state["resources"] = [resource if item["id"] == resource_id else item for item in state["resources"]]
        state = await asyncio.to_thread(store.save, state)
    return {"resource": resource, "revision": state["revision"]}


@router.delete("/planning/resources/{resource_id}", dependencies=[Depends(require_role("editor"))])
async def delete_resource(resource_id: str):
    async with _mutation_lock:
        store = _store()
        state = await asyncio.to_thread(store.load)
        if not any(item["id"] == resource_id for item in state["resources"]):
            raise _not_found("resource")
        if any(item["resource_id"] == resource_id for item in state["assignments"]):
            raise HTTPException(status_code=409, detail="Delete resource assignments before deleting the resource")
        state["resources"] = [item for item in state["resources"] if item["id"] != resource_id]
        state = await asyncio.to_thread(store.save, state)
    return {"deleted": resource_id, "revision": state["revision"]}


@router.post("/planning/assignments", dependencies=[Depends(require_role("editor"))])
async def create_assignment(payload: AssignmentPayload):
    async with _mutation_lock:
        store = _store()
        state = await asyncio.to_thread(store.load)
        try:
            assignment = normalize_assignment(_payload(payload), {item["id"] for item in state["resources"]})
        except PlanningValidationError as error:
            raise _validation_error(error) from error
        state["assignments"].append(assignment)
        state = await asyncio.to_thread(store.save, state)
    return {"assignment": assignment, "revision": state["revision"]}


@router.patch("/planning/assignments/{assignment_id}", dependencies=[Depends(require_role("editor"))])
async def update_assignment(assignment_id: str, payload: AssignmentPayload):
    async with _mutation_lock:
        store = _store()
        state = await asyncio.to_thread(store.load)
        current = next((item for item in state["assignments"] if item["id"] == assignment_id), None)
        if not current:
            raise _not_found("assignment")
        try:
            assignment = normalize_assignment(
                {**current, **_payload(payload)},
                {item["id"] for item in state["resources"]},
                existing_id=assignment_id,
            )
        except PlanningValidationError as error:
            raise _validation_error(error) from error
        state["assignments"] = [assignment if item["id"] == assignment_id else item for item in state["assignments"]]
        state = await asyncio.to_thread(store.save, state)
    return {"assignment": assignment, "revision": state["revision"]}


@router.delete("/planning/assignments/{assignment_id}", dependencies=[Depends(require_role("editor"))])
async def delete_assignment(assignment_id: str):
    async with _mutation_lock:
        store = _store()
        state = await asyncio.to_thread(store.load)
        if not any(item["id"] == assignment_id for item in state["assignments"]):
            raise _not_found("assignment")
        state["assignments"] = [item for item in state["assignments"] if item["id"] != assignment_id]
        state = await asyncio.to_thread(store.save, state)
    return {"deleted": assignment_id, "revision": state["revision"]}

"""API for normalized project-planning resources and allocation reports."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.services.project_planning import (
    DEFAULT_CALENDAR_ID,
    PlanningStore,
    PlanningValidationError,
    calculate_allocation,
    normalize_assignment,
    normalize_calendar,
    normalize_resource,
)
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


def _payload(value: BaseModel) -> dict:
    if hasattr(value, "model_dump"):
        return value.model_dump(exclude_none=True)
    return value.dict(exclude_none=True)


def _store() -> PlanningStore:
    return PlanningStore(Path(get_active_vault_path()) / ".gnosi")


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

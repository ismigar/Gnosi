"""Governed tools over Gnosi's authoritative project-planning services."""
from __future__ import annotations

import json
from typing import Dict, Optional

from langchain_core.tools import tool


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


@tool
async def planning_get_state() -> str:
    """Read planning entities and the current derived allocation snapshot."""
    from backend.api.planning_routes import get_planning_state

    return _json(await get_planning_state())


@tool
async def planning_get_allocation() -> str:
    """Read resource allocation, cost summaries, and capacity warnings."""
    from backend.api.planning_routes import get_allocation

    return _json(await get_allocation())


@tool
async def planning_get_project_schedule(project_id: str) -> str:
    """Read one exact project schedule, diagnostics, and critical tasks."""
    from backend.api.planning_routes import get_project_schedule

    return _json(await get_project_schedule(project_id))


@tool
async def planning_get_leveling_proposal() -> str:
    """Calculate read-only resource-leveling suggestions without applying them."""
    from backend.api.planning_routes import get_leveling_proposal

    return _json(await get_leveling_proposal())


@tool
async def planning_get_baseline_variance(
    project_id: str,
    baseline_id: str,
) -> str:
    """Compare a current project schedule and costs with one exact baseline."""
    from backend.api.planning_routes import get_baseline_variance

    return _json(await get_baseline_variance(project_id, baseline_id))


@tool
async def planning_list_worklogs(task_id: str = "") -> str:
    """Read bounded worklog history, optionally for one exact task id."""
    from backend.api.planning_routes import list_worklogs

    result = await list_worklogs(task_id or None)
    result["worklogs"] = list(result.get("worklogs") or [])[-200:]
    return _json(result)


@tool
async def planning_create_worklog(
    task_id: str,
    date: str,
    hours: float,
    resource_id: str = "",
    correction_of: str = "",
) -> str:
    """Create one worklog after an explicit current-turn request."""
    from backend.api.planning_routes import WorklogPayload, create_worklog

    return _json(await create_worklog(WorklogPayload(
        task_id=task_id,
        resource_id=resource_id or None,
        date=date,
        hours=hours,
        correction_of=correction_of or None,
    )))


@tool
async def planning_create_baseline(
    project_id: str,
    name: str,
    schedule_revision: Optional[int] = None,
) -> str:
    """Capture one immutable project baseline after an explicit request."""
    from backend.api.planning_routes import BaselinePayload, create_baseline

    return _json(await create_baseline(
        project_id,
        BaselinePayload(name=name, schedule_revision=schedule_revision),
    ))


@tool
async def planning_create_leveling_proposal(project_id: str) -> str:
    """Persist a reviewable resource-leveling proposal for one project."""
    from backend.api.planning_routes import create_leveling_proposal

    return _json(await create_leveling_proposal(project_id))


@tool
async def planning_apply_leveling_proposal(
    proposal_id: str,
    schedule_revision: int,
    etags: Dict[str, str],
) -> str:
    """Apply one exact reviewed leveling proposal with revision preconditions."""
    from backend.api.planning_routes import ProposalApplyPayload, apply_leveling_proposal

    return _json(await apply_leveling_proposal(
        proposal_id,
        ProposalApplyPayload(schedule_revision=schedule_revision, etags=etags),
    ))


@tool
async def planning_create_recurrence(
    task_id: str,
    rrule: str,
    exdates: list[str] | None = None,
) -> str:
    """Store a bounded recurrence declaration after an explicit request."""
    from backend.api.planning_routes import RecurrencePayload, create_recurrence

    return _json(await create_recurrence(RecurrencePayload(
        task_id=task_id,
        rrule=rrule,
        exdates=exdates or [],
    )))


@tool
async def planning_materialize_recurrence(
    recurrence_id: str,
    limit: int = 20,
) -> str:
    """Materialize bounded recurring task pages after an explicit bulk-write request."""
    from backend.api.planning_routes import materialize_recurrence

    return _json(await materialize_recurrence(recurrence_id, limit=max(1, min(limit, 50))))


PLANNING_READ_TOOLS = [
    planning_get_state,
    planning_get_allocation,
    planning_get_project_schedule,
    planning_get_leveling_proposal,
    planning_get_baseline_variance,
    planning_list_worklogs,
]
PLANNING_WRITE_TOOLS = [
    planning_create_worklog,
    planning_create_baseline,
    planning_create_leveling_proposal,
    planning_apply_leveling_proposal,
    planning_create_recurrence,
    planning_materialize_recurrence,
]

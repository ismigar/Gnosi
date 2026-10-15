"""Project ownership and atomic validation of resource-assignment changes."""

from typing import Any

from backend.services.project_planning import PlanningValidationError


def project_assignment_ids(state: dict[str, Any], project_id: str, task_ids: set[str]) -> set[str]:
    """Explicit ownership wins; legacy assignments follow their task."""
    return {
        item["id"] for item in state["assignments"]
        if item.get("project_id") == project_id
        or (not item.get("project_id") and item["task_id"] in task_ids)
    }


def apply_project_leveling(
    state: dict[str, Any], proposal: dict[str, Any], task_ids: set[str]
) -> list[dict[str, Any]]:
    """Validate every change before mutating even the caller's state snapshot."""
    if state["revision"] != proposal.get("revision"):
        raise PlanningValidationError("Planning assignments changed; regenerate the proposal")
    by_assignment = {item["id"]: item for item in state["assignments"]}
    allowed = project_assignment_ids(state, proposal["projectId"], task_ids)
    seen: set[str] = set()
    for change in proposal["proposals"]:
        assignment_id = change["assignment_id"]
        if assignment_id not in allowed or assignment_id in seen:
            raise PlanningValidationError("Proposal includes an out-of-scope or repeated assignment")
        seen.add(assignment_id)
        assignment = by_assignment[assignment_id]
        if (assignment.get("start") != change.get("source_start", assignment.get("start"))
                or assignment.get("end") != change.get("source_end", assignment.get("end"))):
            raise PlanningValidationError("An assignment changed; regenerate the proposal")
    applied = []
    for change in proposal["proposals"]:
        assignment = by_assignment[change["assignment_id"]]
        assignment["start"] = change["suggested_start"]
        assignment["end"] = change["suggested_end"]
        applied.append({"assignmentId": assignment["id"], "start": assignment["start"], "end": assignment["end"]})
    return applied

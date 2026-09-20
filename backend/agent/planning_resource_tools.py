"""Planning resource mutations backed by the canonical validated endpoints."""

from typing import Literal

from langchain_core.tools import tool

from backend.agent.feature_tool_support import feature_context, result_json
from backend.domains.planning.schemas import AssignmentPayload, CalendarPayload, ResourcePayload


@tool
async def planning_list_baselines(project_id: str) -> str:
    """List a project's saved baselines and exact IDs before comparing variance."""
    from backend.api.planning_routes import list_baselines

    feature_context("project-planning")
    return result_json(await list_baselines(project_id))


@tool
async def planning_save_calendar(calendar: CalendarPayload, calendar_id: str = "") -> str:
    """Create a work calendar or update an exact calendar ID with weekdays, holidays and hours."""
    from backend.api.planning_routes import create_calendar, update_calendar

    feature_context("project-planning", "editor")
    return result_json(
        await update_calendar(calendar_id, calendar)
        if calendar_id
        else await create_calendar(calendar)
    )


@tool
async def planning_save_resource(resource: ResourcePayload, resource_id: str = "") -> str:
    """Create a planning resource or update its capacity, work calendar and cost rates by exact ID."""
    from backend.api.planning_routes import create_resource, update_resource

    feature_context("project-planning", "editor")
    return result_json(
        await update_resource(resource_id, resource)
        if resource_id
        else await create_resource(resource)
    )


@tool
async def planning_save_assignment(assignment: AssignmentPayload, assignment_id: str = "") -> str:
    """Assign a resource to a task or update an exact assignment's workload and dates."""
    from backend.api.planning_routes import create_assignment, update_assignment

    feature_context("project-planning", "editor")
    return result_json(
        await update_assignment(assignment_id, assignment)
        if assignment_id
        else await create_assignment(assignment)
    )


@tool
async def planning_delete_entity(
    kind: Literal["calendar", "resource", "assignment"], entity_id: str
) -> str:
    """Delete an exact planning calendar, resource or assignment after confirmation; dependency checks remain enforced."""
    from backend.api.planning_routes import delete_calendar, delete_resource, delete_assignment

    feature_context("project-planning", "editor")
    handlers = {
        "calendar": delete_calendar,
        "resource": delete_resource,
        "assignment": delete_assignment,
    }
    return result_json(await handlers[kind](entity_id))


PLANNING_RESOURCE_READ_TOOLS = [planning_list_baselines]
PLANNING_RESOURCE_WRITE_TOOLS = [
    planning_save_calendar,
    planning_save_resource,
    planning_save_assignment,
]
PLANNING_RESOURCE_DELETE_TOOLS = [planning_delete_entity]

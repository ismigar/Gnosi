"""Scoped inspection of schedules and execution outcomes, without self-grants."""

from langchain_core.tools import tool

from backend.agent.action_confirmations import current_confirmation_scope
from backend.agent.feature_tool_support import feature_context, result_json


@tool
def activity_list_automations(offset: int = 0, limit: int = 25) -> str:
    """List this user's skill automations in the active workspace and Vault."""
    from backend.services.capability_automations import list_automations

    feature_context("automations")
    items = list_automations(current_confirmation_scope())
    offset, limit = max(0, offset), max(1, min(limit, 50))
    return result_json(
        {"automations": items[offset : offset + limit], "total": len(items), "offset": offset}
    )


@tool
def activity_read_runs(automation_id: str = "", offset: int = 0, limit: int = 25) -> str:
    """Read actual run outcomes and final results for this user's scoped automations."""
    from backend.services.automation_history import list_scoped_runs

    feature_context("automations")
    return result_json(
        list_scoped_runs(
            current_confirmation_scope(),
            automation_id=automation_id or None,
            offset=max(0, offset),
            limit=max(1, min(limit, 50)),
        )
    )


@tool
def activity_list_system_schedules() -> str:
    """Inspect system service schedules in the personal workspace without running or editing them."""
    from backend.scheduler.manager import scheduler_manager

    context = feature_context("automations")
    if context.workspace_id != "personal":
        raise PermissionError("System-wide schedules require the personal workspace.")
    return result_json({"schedules": scheduler_manager.get_tasks()})


ACTIVITY_READ_TOOLS = [
    activity_list_automations,
    activity_read_runs,
    activity_list_system_schedules,
]

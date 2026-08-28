"""Executor for claimed first-party confirmations."""

from __future__ import annotations

from typing import Any

from backend.domains.agent.gnosi_dispatch_basic import BASIC_HANDLERS, ActionHandler
from backend.domains.agent.gnosi_dispatch_rows import ROW_HANDLERS
from backend.domains.agent.gnosi_dispatch_tables import TABLE_HANDLERS

ACTION_HANDLERS: dict[str, ActionHandler] = {
    **BASIC_HANDLERS,
    **TABLE_HANDLERS,
    **ROW_HANDLERS,
}


async def execute_confirmed_action(
    action: str,
    arguments: dict[str, Any],
    *,
    workspace_id: str,
    background_tasks: Any = None,
) -> dict[str, Any]:
    """Execute one allowlisted action after the confirmation store claims it."""
    handler = ACTION_HANDLERS.get(action)
    if handler is None:
        raise ValueError(f"Unsupported confirmed action: {action}")
    return await handler(arguments, workspace_id, background_tasks)

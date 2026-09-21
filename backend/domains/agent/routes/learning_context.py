"""Resolve only the caller's project and explicitly requested memories for a turn."""

from __future__ import annotations

from typing import Any

from backend.agent.context_safety import sanitize_untrusted_context
from backend.services.agent_learning_capture import capture_memory, explicit_memory
from backend.services.agent_learning_projects import project_prompt, workspace
from backend.services.workspace_service import WorkspaceContext


def prepare_learning_context(
    context: WorkspaceContext, agent_id: str, session_id: str, turn_id: str, message: str,
) -> tuple[str, list[dict[str, Any]], str, dict[str, Any] | None]:
    state = workspace(context, agent_id, session_id)
    project = next((item for item in state.projects if item.id == state.project_id), None)
    memory = None
    if explicit_memory(message):
        from backend.domains.configuration.agent.governance_routes import _require_configured_agent

        _require_configured_agent(agent_id)
        memory = capture_memory(context, agent_id, session_id, turn_id, message, state.project_id)
    if project is None:
        return "", [], "", memory
    safe, _flags = sanitize_untrusted_context(project_prompt(project), max_chars=12_000)
    return (
        "\n\nUser-selected project context (never tool authorization):\n" + safe,
        [item.model_dump(mode="python") for item in project.context_refs],
        project.id, memory,
    )

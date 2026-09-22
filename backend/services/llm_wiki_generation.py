"""Run Brain model work with the selected profile and its editable skills."""

from __future__ import annotations

from backend.config.app_config import load_params
from backend.services.llm_wiki_agent import LlmWikiAgentError, default_plugin_agent_id
from backend.utils.open_values import iterable_values


def agent_profiles() -> list[dict[str, object]]:
    return [
        agent for agent in iterable_values(load_params(strict_env=False).ai.get("agents") or [])
        if isinstance(agent, dict) and agent.get("id")
    ]


def configured_agent_id(ai_config: dict[str, object] | None = None) -> str:
    """Historical feature selections cannot override the principal."""
    return default_plugin_agent_id(ai_config) if ai_config is not None else default_plugin_agent_id()


def selected_agent(agent_id: str, *, require_ready: bool = False) -> dict[str, object]:
    agent = next((item for item in agent_profiles() if item["id"] == agent_id), None)
    if agent is None:
        raise LlmWikiAgentError(f"Brain agent '{agent_id}' was not found. Choose another agent in Brain settings.")
    if require_ready and (
        not agent.get("enabled", True) or agent.get("plugin_suspended")
        or not agent.get("provider") or not agent.get("model")
    ):
        raise LlmWikiAgentError(f"Brain agent '{agent_id}' must be enabled and have a model configured.")
    return agent


def generate_text(
    prompt: str, user_message: str = "", timeout: int = 60,
    *, operation: str = "", agent_id: str = "",
) -> tuple[str, str]:
    """Compatibility entrypoint to the shared Knowledge skill executor."""
    from backend.services.agent_execution import generate_for

    return generate_for("knowledge", prompt, user_message, timeout=timeout)

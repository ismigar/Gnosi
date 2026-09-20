"""Run Brain model work with the selected profile and its editable skills."""

from __future__ import annotations

from backend.config.app_config import load_params
from backend.services import llm_wiki_config
from backend.services.llm_wiki_agent import LlmWikiAgentError, default_plugin_agent_id
from backend.utils.open_values import iterable_values


def agent_profiles() -> list[dict[str, object]]:
    return [
        agent for agent in iterable_values(load_params(strict_env=False).ai.get("agents") or [])
        if isinstance(agent, dict) and agent.get("id")
    ]


def configured_agent_id() -> str:
    """Keep explicit selections; resolve the default only for unconfigured vaults."""
    return str(llm_wiki_config.load_config().get("agent_id") or "").strip() or default_plugin_agent_id()


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
    """Use available assigned instructions without granting or calling tools."""
    from backend.agent import factory
    from backend.models.agent_skills import SkillActivation, SkillKind
    from backend.services.agent_skill_catalog import get_skill_catalog

    chosen_id = agent_id or configured_agent_id()
    profile = selected_agent(chosen_id, require_ready=True)
    assigned = {str(value) for value in iterable_values(profile.get("skill_ids") or [])}
    instructions = [str(profile.get("persona") or ""), str(profile.get("context") or "")]
    for entry in get_skill_catalog().list_entries():
        skill = entry.descriptor
        if not entry.available or skill.id not in assigned or skill.kind != SkillKind.AGENT:
            continue
        if skill.activation == SkillActivation.EXPLICIT and operation not in skill.tool_ids:
            continue
        instructions.append(skill.instructions)
    return factory.generate_text(
        prompt, user_message=user_message, timeout=timeout, agent_id=chosen_id,
        system_prompt="\n\n".join(text for text in instructions if text.strip()),
    )

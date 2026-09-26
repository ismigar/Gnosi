"""Lifecycle and protection rules for the built-in LLM Wiki agent profile."""
from __future__ import annotations

from backend.services.agent_behavior import resource as behavior_resource

from copy import deepcopy
import threading


import yaml

from backend.config.app_config import load_params
from backend.utils.open_values import contains_value, get_value, iterable_values, list_values
from backend.utils.safe_io import safe_write_text

LLM_WIKI_AGENT_ID = "llm-wiki"
LLM_WIKI_AGENT_MARKER = "llm-wiki"
LEGACY_LLM_WIKI_SKILL_IDS = [
    "plugin.llm-wiki.query",
    "plugin.llm-wiki.process-source",
    "plugin.llm-wiki.process-status",
    "plugin.llm-wiki.maintain",
    "plugin.llm-wiki.propose-connections",
]
LLM_WIKI_SKILL_IDS = [
    *LEGACY_LLM_WIKI_SKILL_IDS,
    "core.gnosi-vault",
]
LLM_WIKI_REQUIRED_SKILL_IDS: list[str] = []
LEGACY_DEFAULT_SKILL_IDS = ["core.legacy-default-v1"]

DEFAULT_PERSONA = behavior_resource('agents/legacy-knowledge.md')

_config_lock = threading.RLock()


class LlmWikiAgentError(ValueError):
    """Raised when the reserved LLM Wiki agent id is used by another profile."""


def _managed_agent(agents: list[object]) -> dict[str, object] | None:
    """Returns the reserved profile when it is owned by LLM Wiki."""
    for agent in agents:
        if isinstance(agent, dict) and agent.get("id") == LLM_WIKI_AGENT_ID:
            return agent
    return None


def _model_seed(agents: list[object], active_agent_id: str) -> tuple[str, str]:
    """Finds a configured profile whose model can seed the new profile."""
    ordered = sorted(agents, key=lambda agent: get_value(agent, "id") != active_agent_id)
    for agent in ordered:
        if not isinstance(agent, dict):
            continue
        provider = str(agent.get("provider") or "").strip()
        model = str(agent.get("model") or "").strip()
        if provider and model:
            return provider, model
    return "", ""


def ensure_agent(ai_config: dict[str, object], *, create: bool = True) -> tuple[dict[str, object], bool]:
    """Creates the managed profile without overwriting a user's edits."""
    next_ai = deepcopy(ai_config or {})
    agents = list_values(next_ai.get("agents") or [])
    existing = _managed_agent(agents)
    if existing:
        if existing.get("managed_by") != LLM_WIKI_AGENT_MARKER:
            if not create:
                return next_ai, False
            raise LlmWikiAgentError(
                "The reserved 'llm-wiki' ID already belongs to another agent; it was not changed."
            )
        changed = False
        # The global assignment migration may have materialized the legacy
        # bundle before this plugin-specific migration runs. Replace only that
        # exact synthetic value; preserve every explicit user selection.
        if not existing.get("skills_seed_version") and (
            "skill_ids" not in existing
            or existing.get("skill_ids") == LEGACY_DEFAULT_SKILL_IDS
            or existing.get("skill_ids") == LEGACY_LLM_WIKI_SKILL_IDS
        ):
            existing["skill_ids"] = list(LLM_WIKI_SKILL_IDS)
            changed = True
        if not existing.get("skills_seed_version"):
            existing["skills_seed_version"] = 1
            changed = True
        # Older installations locked the query skill. Allow its replacement
        # with a user-edited copy, preserving unrelated explicit requirements.
        required_skill_ids = [
            value for value in list_values(existing.get("required_skill_ids") or [])
            if value != "plugin.llm-wiki.query"
        ]
        if existing.get("required_skill_ids") != required_skill_ids:
            changed = True
        existing["required_skill_ids"] = required_skill_ids
        if existing.pop("plugin_suspended", False):
            existing["enabled"] = bool(
                existing.pop(
                    "plugin_enabled_before_suspend",
                    bool(existing.get("provider") and existing.get("model")),
                )
            )
            changed = True
        next_ai["agents"] = agents
        return next_ai, changed

    if not create:
        return next_ai, False

    provider, model = _model_seed(agents, str(next_ai.get("active_agent_id") or ""))
    agents.append({
        "id": LLM_WIKI_AGENT_ID,
        "managed_by": LLM_WIKI_AGENT_MARKER,
        "name": "Brain",
        "icon": "🧠",
        "provider": provider,
        "model": model,
        # A profile without an explicit model must not become a surprise
        # fallback consumer. It appears in Settings so the user can configure
        # it, then enables it deliberately.
        "enabled": bool(provider and model),
        "persona": DEFAULT_PERSONA,
        "context": "",
        "context_refs": [],
        "skill_ids": list(LLM_WIKI_SKILL_IDS),
        "skills_seed_version": 1,
        "required_skill_ids": list(LLM_WIKI_REQUIRED_SKILL_IDS),
    })
    next_ai["agents"] = agents
    return next_ai, True


def remove_agent(ai_config: dict[str, object]) -> tuple[dict[str, object], bool]:
    """Removes only the profile created and owned by this built-in feature."""
    next_ai = deepcopy(ai_config or {})
    agents = list_values(next_ai.get("agents") or [])
    existing = _managed_agent(agents)
    if not existing:
        next_ai["agents"] = agents
        return next_ai, False
    if existing.get("managed_by") != LLM_WIKI_AGENT_MARKER:
        raise LlmWikiAgentError(
            "The reserved 'llm-wiki' ID is not managed by the plugin and cannot be removed."
        )
    next_ai["agents"] = [agent for agent in agents if agent is not existing]
    if next_ai.get("active_agent_id") == LLM_WIKI_AGENT_ID:
        next_ai["active_agent_id"] = next(
            (
                str(agent.get("id") or "")
                for agent in iterable_values(next_ai["agents"])
                if isinstance(agent, dict) and agent.get("enabled", True)
            ),
            "",
        )
    return next_ai, True


def suspend_agent(ai_config: dict[str, object]) -> tuple[dict[str, object], bool]:
    """Suspend the managed profile while preserving all user overrides."""

    next_ai = deepcopy(ai_config or {})
    agents = list_values(next_ai.get("agents") or [])
    existing = _managed_agent(agents)
    if not existing:
        next_ai["agents"] = agents
        return next_ai, False
    if existing.get("managed_by") != LLM_WIKI_AGENT_MARKER:
        return next_ai, False
    if existing.get("plugin_suspended"):
        next_ai["agents"] = agents
        return next_ai, False
    existing["plugin_enabled_before_suspend"] = bool(existing.get("enabled", True))
    existing["plugin_suspended"] = True
    existing["enabled"] = False
    next_ai["agents"] = agents
    if next_ai.get("active_agent_id") == LLM_WIKI_AGENT_ID:
        next_ai["active_agent_id"] = next(
            (
                str(get_value(agent, "id") or "")
                for agent in agents
                if agent is not existing
                and (
                    get_value(agent, "enabled") if contains_value(agent, "enabled") else True
                )
            ),
            "",
        )
    return next_ai, True


def validate_agent_preserved(current_ai: dict[str, object], requested_ai: dict[str, object]) -> None:
    """Rejects generic Settings saves that remove or unmanage the profile."""
    current = _managed_agent(list_values((current_ai or {}).get("agents") or []))
    if not current or current.get("managed_by") != LLM_WIKI_AGENT_MARKER:
        return
    if not isinstance(requested_ai, dict) or "agents" not in requested_ai:
        return
    requested = _managed_agent(list_values(requested_ai.get("agents") or []))
    if not requested or requested.get("managed_by") != LLM_WIKI_AGENT_MARKER:
        raise LlmWikiAgentError(
            "The Brain agent can only be removed by disabling the LLM Wiki plugin."
        )


def default_plugin_agent_id(ai_config: dict[str, object] | None = None) -> str:
    """Resolve the editable profile owned by the Knowledge plugin."""
    from backend.services.principal_agent_migration import ensure_migrated
    ai = ensure_migrated() if ai_config is None else ai_config
    from backend.services.plugin_agent_profiles import select_profile
    from backend.services.agent_operation_catalog import skill_id
    return str(select_profile(ai, skill_id("knowledge"))["id"])


def transition_agent(enabled: bool) -> dict[str, object]:
    """Migrate legacy settings before the lifecycle reconciles plugin profiles."""
    from backend.services.principal_agent_migration import ensure_migrated
    ensure_migrated()
    return {"agent_id": "builtin.llm-wiki.default", "agent_changed": False}

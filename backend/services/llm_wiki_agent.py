"""Lifecycle and protection rules for the built-in LLM Wiki agent profile."""
from __future__ import annotations

from copy import deepcopy
import threading
from typing import Any

import yaml

from backend.config.app_config import load_params
from backend.utils.safe_io import safe_write_text

LLM_WIKI_AGENT_ID = "llm-wiki"
LLM_WIKI_AGENT_MARKER = "llm-wiki"
LLM_WIKI_SKILL_IDS = [
    "plugin.llm-wiki.query",
    "plugin.llm-wiki.process-source",
    "plugin.llm-wiki.process-status",
    "plugin.llm-wiki.maintain",
    "plugin.llm-wiki.propose-connections",
]
LLM_WIKI_REQUIRED_SKILL_IDS = ["plugin.llm-wiki.query"]
LEGACY_DEFAULT_SKILL_IDS = ["core.legacy-default-v1"]

DEFAULT_PERSONA = """You are Gnosi's Brain agent, a persistent knowledge wiki.
Use the skills assigned by the LLM Wiki plugin and any profile-specific instructions
added by the user. Never create permanent notes without human confirmation."""

_config_lock = threading.RLock()


class LlmWikiAgentError(ValueError):
    """Raised when the reserved LLM Wiki agent id is used by another profile."""


def _managed_agent(agents: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Returns the reserved profile when it is owned by LLM Wiki."""
    for agent in agents:
        if isinstance(agent, dict) and agent.get("id") == LLM_WIKI_AGENT_ID:
            return agent
    return None


def _model_seed(agents: list[dict[str, Any]], active_agent_id: str) -> tuple[str, str]:
    """Finds a configured profile whose model can seed the new profile."""
    ordered = sorted(agents, key=lambda agent: agent.get("id") != active_agent_id)
    for agent in ordered:
        if not isinstance(agent, dict):
            continue
        provider = str(agent.get("provider") or "").strip()
        model = str(agent.get("model") or "").strip()
        if provider and model:
            return provider, model
    return "", ""


def ensure_agent(ai_config: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Creates the managed profile without overwriting a user's edits."""
    next_ai = deepcopy(ai_config or {})
    agents = list(next_ai.get("agents") or [])
    existing = _managed_agent(agents)
    if existing:
        if existing.get("managed_by") != LLM_WIKI_AGENT_MARKER:
            raise LlmWikiAgentError(
                "The reserved 'llm-wiki' ID already belongs to another agent; it was not changed."
            )
        changed = False
        # The global assignment migration may have materialized the legacy
        # bundle before this plugin-specific migration runs. Replace only that
        # exact synthetic value; preserve every explicit user selection.
        if (
            "skill_ids" not in existing
            or existing.get("skill_ids") == LEGACY_DEFAULT_SKILL_IDS
        ):
            existing["skill_ids"] = list(LLM_WIKI_SKILL_IDS)
            changed = True
        required_skill_ids = list(existing.get("required_skill_ids") or [])
        for skill_id in LLM_WIKI_REQUIRED_SKILL_IDS:
            if skill_id not in required_skill_ids:
                required_skill_ids.append(skill_id)
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
        "required_skill_ids": list(LLM_WIKI_REQUIRED_SKILL_IDS),
    })
    next_ai["agents"] = agents
    return next_ai, True


def remove_agent(ai_config: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Removes only the profile created and owned by this built-in feature."""
    next_ai = deepcopy(ai_config or {})
    agents = list(next_ai.get("agents") or [])
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
            (str(agent.get("id") or "") for agent in next_ai["agents"] if agent.get("enabled", True)),
            "",
        )
    return next_ai, True


def suspend_agent(ai_config: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Suspend the managed profile while preserving all user overrides."""

    next_ai = deepcopy(ai_config or {})
    agents = list(next_ai.get("agents") or [])
    existing = _managed_agent(agents)
    if not existing:
        next_ai["agents"] = agents
        return next_ai, False
    if existing.get("managed_by") != LLM_WIKI_AGENT_MARKER:
        raise LlmWikiAgentError(
            "The reserved 'llm-wiki' ID is not managed by the plugin and cannot be suspended."
        )
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
                str(agent.get("id") or "")
                for agent in agents
                if agent is not existing and agent.get("enabled", True)
            ),
            "",
        )
    return next_ai, True


def validate_agent_preserved(current_ai: dict[str, Any], requested_ai: dict[str, Any]) -> None:
    """Rejects generic Settings saves that remove or unmanage the profile."""
    current = _managed_agent(list((current_ai or {}).get("agents") or []))
    if not current or current.get("managed_by") != LLM_WIKI_AGENT_MARKER:
        return
    if not isinstance(requested_ai, dict) or "agents" not in requested_ai:
        return
    requested = _managed_agent(list(requested_ai.get("agents") or []))
    if not requested or requested.get("managed_by") != LLM_WIKI_AGENT_MARKER:
        raise LlmWikiAgentError(
            "The Brain agent can only be removed by disabling the LLM Wiki plugin."
        )


def transition_agent(enabled: bool) -> dict[str, Any]:
    """Persists the profile transition in the active vault's AI configuration."""
    with _config_lock:
        cfg = load_params(strict_env=False)
        path = cfg.params_source
        persisted: dict[str, Any] = {}
        if path.exists():
            try:
                persisted = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            except (OSError, yaml.YAMLError) as exc:
                raise LlmWikiAgentError(f"Could not read the AI configuration: {exc}") from exc
        if not isinstance(persisted, dict):
            persisted = {}

        if enabled:
            next_ai, changed = ensure_agent(dict(cfg.ai or {}))
        else:
            next_ai, changed = suspend_agent(dict(cfg.ai or {}))
        if changed:
            persisted["ai"] = next_ai
            yaml_text = yaml.safe_dump(
                persisted,
                default_flow_style=False,
                allow_unicode=True,
                sort_keys=False,
            )
            safe_write_text(path, yaml_text)
        return {"agent_id": LLM_WIKI_AGENT_ID, "agent_changed": changed}

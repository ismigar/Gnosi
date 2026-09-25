"""Editable, plugin-owned profiles for standalone application operations."""
from __future__ import annotations

from copy import deepcopy
from typing import Any

from backend.services.agent_operation_catalog import OPERATIONS, skill_id
from backend.services.builtin_plugins import is_enabled

PROFILE_NAMES = {
    "ai-platform": "Writing and knowledge capture", "feeds-reader": "Feeds and podcasts",
    "grounded-notebooks": "Grounded notebooks", "resources": "Literature assistance",
    "mail": "Mail", "social-publishing": "Social publishing", "calendar": "Meetings",
    "translation": "Translation", "llm-wiki": "Knowledge",
}


def declarations() -> dict[str, dict[str, Any]]:
    result = {}
    for plugin, name in PROFILE_NAMES.items():
        skills = list(dict.fromkeys(skill_id(key) for key, (owner, _, _) in OPERATIONS.items() if owner == plugin))
        if plugin == "llm-wiki":
            from backend.services.llm_wiki_agent import LLM_WIKI_SKILL_IDS
            skills = list(dict.fromkeys([*skills, *LLM_WIKI_SKILL_IDS]))
        result[plugin] = {"id": f"builtin.{plugin}.default", "name": name,
                          "managed_by": f"builtin:{plugin}", "skill_ids": skills}
    return result


def reconcile(ai: dict[str, Any], state: dict[str, Any]) -> bool:
    """Seed defaults once; plugin updates never overwrite user configuration."""
    agents = ai.setdefault("agents", [])
    by_id = {p.get("id"): p for p in agents if isinstance(p, dict)}
    from backend.services.principal_agent_migration import principal_profile
    try:
        default = principal_profile(ai)
    except RuntimeError:
        default = {}
    changed = False
    for plugin, template in declarations().items():
        current = by_id.get(template["id"])
        enabled = is_enabled(state, plugin)
        if current is None:
            if not enabled:
                continue
            current = {**deepcopy(template), "enabled": True, "icon": "Bot",
                       "provider": default.get("provider", ""), "model": default.get("model", ""),
                       "persona": "", "context": "", "context_refs": [],
                       "model_strategy": {"schema_version": 1, "mode": "pinned", "decision_engine": "rules", "allowed_models": []}}
            if plugin == "llm-wiki":
                current["skill_ids"].extend(identifier for identifier in default.get("skill_ids", [])
                                            if isinstance(identifier, str) and identifier.startswith("user.knowledge-migrated-"))
            agents.append(current)
            changed = True
        if current.get("managed_by") != template["managed_by"]:
            raise ValueError("plugin_profile_identity_conflict")
        if current.get("plugin_suspended", False) != (not enabled):
            current["plugin_suspended"] = not enabled
            changed = True
    return changed


def owner_for_skill(selected: str) -> str:
    for plugin, template in declarations().items():
        if selected in template["skill_ids"]:
            return f"builtin:{plugin}"
    if selected.startswith("plugin."):
        # Resolve external ownership from the registered descriptor, never by parsing IDs.
        from backend.services.agent_skill_catalog import get_skill_catalog
        for entry in get_skill_catalog().list_entries():
            if entry.descriptor.id == selected:
                return f"plugin:{entry.descriptor.origin.id}"
    return ""


def select_profile(ai: dict[str, Any], selected_skill: str) -> dict[str, Any]:
    from backend.services.principal_agent_migration import principal_profile
    owner = owner_for_skill(selected_skill)
    if not owner:
        return principal_profile(ai)
    candidates = [p for p in ai.get("agents", []) if isinstance(p, dict)
                  and p.get("managed_by") == owner and selected_skill in (p.get("skill_ids") or [])]
    ready = [p for p in candidates if p.get("enabled", True) and not p.get("plugin_suspended")]
    if len(ready) != 1:
        raise RuntimeError(f"plugin_profile_unavailable:{owner}")
    return deepcopy(ready[0])


def validate_preserved(current: dict[str, Any], requested: dict[str, Any]) -> None:
    if "agents" not in requested:
        return
    new = {p.get("id"): p for p in requested["agents"] if isinstance(p, dict)}
    for profile in current.get("agents", []):
        owner = str(profile.get("managed_by") or "")
        if not owner.startswith(("builtin:", "plugin:")):
            continue
        replacement = new.get(profile["id"], {})
        if replacement.get("managed_by") != owner:
            raise ValueError("plugin_profile_must_be_preserved")
        if replacement.get("plugin_suspended", False) != profile.get("plugin_suspended", False):
            raise ValueError("plugin_profile_lifecycle_owned_by_plugin")

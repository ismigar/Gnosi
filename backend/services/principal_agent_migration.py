"""Idempotent, backed-up migration from feature-owned agents to the principal."""
from __future__ import annotations

import copy
import hashlib
import threading
from pathlib import Path
from typing import Any

import yaml

from backend.services.agent_operation_catalog import OPERATIONS, skill_id
from backend.utils.safe_io import file_etag, safe_write_text

VERSION = 1
_LOCK = threading.RLock()


def principal_profile(ai: dict[str, Any]) -> dict[str, Any]:
    agents = [a for a in ai.get("agents", []) if isinstance(a, dict)]
    active = str(ai.get("active_agent_id") or "")
    profile = next((a for a in agents if a.get("id") == active), None) if active else next(
        (a for a in agents if a.get("enabled", True) and not a.get("managed_by")), None,
    )
    if not profile or not profile.get("enabled", True) or profile.get("managed_by"):
        raise RuntimeError("principal_agent_unavailable")
    return dict(profile)


def migrate(params: dict[str, Any], enabled: set[str]) -> tuple[dict[str, Any], bool]:
    result = copy.deepcopy(params)
    ai = result.setdefault("ai", {})
    if ai.get("principal_execution_version") == VERSION:
        return result, False
    agents = [a for a in ai.get("agents", []) if isinstance(a, dict)]
    legacy = next((a for a in agents if a.get("id") == "llm-wiki" and a.get("managed_by") == "llm-wiki"), None)
    active = str(ai.get("active_agent_id") or "")
    if legacy:
        ai.setdefault("retired_profiles", {})["llm-wiki"] = copy.deepcopy(legacy)
        agents.remove(legacy)
        if active == "llm-wiki":
            identifier = "principal"
            while any(a.get("id") == identifier for a in agents):
                identifier += "-migrated"
            profile = {k: copy.deepcopy(v) for k, v in legacy.items() if k not in {"managed_by", "persona", "context", "context_refs", "required_skill_ids", "plugin_suspended"}}
            profile.update(id=identifier, name="Agent principal", persona="", context="", context_refs=[])
            agents.append(profile)
            ai["active_agent_id"] = identifier
    ai["agents"] = agents
    try:
        selected = principal_profile(ai)
    except RuntimeError:
        # Retry after the user configures a principal; never manufacture a model.
        return result, bool(legacy)
    profile = next(a for a in agents if a.get("id") == selected["id"])
    ai["active_agent_id"] = profile["id"]
    assigned = list(profile.get("skill_ids") or []) if "skill_ids" in profile else ["core.legacy-default-v1"]
    if "llm-wiki" in enabled:
        from backend.domains.llm_wiki.reading_skill import SKILL_ID
        assigned.append(SKILL_ID)
    assigned.extend(skill_id(key) for key, (plugin, _, _) in OPERATIONS.items() if plugin in enabled)
    if legacy and "llm-wiki" in enabled:
        assigned.extend(legacy.get("skill_ids") or [])
    legacy = legacy or ai.get("retired_profiles", {}).get("llm-wiki")
    if legacy:
        # Preserve disabled features without assigning their companion skill.
        ai["knowledge_legacy_instructions"] = "\n\n".join(str(legacy.get(k) or "") for k in ("persona", "context")).strip()
    profile["skill_ids"] = list(dict.fromkeys(assigned))
    ai["principal_execution_version"] = VERSION
    return result, True


def ensure_migrated() -> dict[str, Any]:
    from backend.config.app_config import load_params
    from backend.services.builtin_plugins import BUILTIN_PLUGIN_IDS, is_enabled
    from backend.api.vault_routes import _load_plugins_state

    with _LOCK:
        cfg = load_params(strict_env=False)
        if cfg.ai.get("principal_execution_version") == VERSION:
            return dict(cfg.ai)
        state = _load_plugins_state()
        enabled = {identifier for identifier in BUILTIN_PLUGIN_IDS if is_enabled(state, identifier)}
        migrated, changed = migrate(cfg.params, enabled)
        if changed:
            path = Path(cfg.params_source)
            original_etag = file_etag(path)
            backup = path.with_name(path.name + ".before-principal-v1")
            if not backup.exists():
                safe_write_text(backup, path.read_text() if path.exists() else yaml.safe_dump(cfg.params))
            legacy_text = str(migrated["ai"].get("knowledge_legacy_instructions") or "")
            if legacy_text:
                from backend.services.context_vars import get_active_vault_path
                from backend.services.user_skill_store import UserSkillStore, UserSkillNotFoundError
                vault = get_active_vault_path()
                if vault is None:
                    raise RuntimeError("agent_execution_scope_required")
                skill_store = UserSkillStore(Path(vault))
                identifier = "user.knowledge-migrated-" + hashlib.sha256(legacy_text.encode()).hexdigest()[:16]
                try:
                    skill_store.load(identifier)
                except UserSkillNotFoundError:
                    skill_store.create({
                        "name": "Knowledge personal instructions", "activation": "explicit",
                        "metadata": {"migration": VERSION, "companion_for": [skill_id("knowledge"), "plugin.llm-wiki.process-source"], "provenance": "managed-brain"},
                    }, legacy_text, requested_id=identifier)
                profile = principal_profile(migrated["ai"])
                for entry in migrated["ai"]["agents"]:
                    if entry["id"] == profile["id"] and "llm-wiki" in enabled:
                        entry["skill_ids"] = list(dict.fromkeys([*entry.get("skill_ids", []), identifier]))
                migrated["ai"].pop("knowledge_legacy_instructions", None)
            if file_etag(path) != original_etag:
                raise RuntimeError("agent_migration_configuration_changed_retry")
            safe_write_text(path, yaml.safe_dump(migrated, allow_unicode=True, sort_keys=False))
        return dict(migrated.get("ai") or {})

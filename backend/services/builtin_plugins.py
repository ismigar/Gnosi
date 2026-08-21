"""Registry and state rules for Gnosi's optional built-in capabilities."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

PLUGIN_STATE_VERSION = 2


BUILTIN_PLUGINS: tuple[dict[str, Any], ...] = (
    {
        "id": "daily-notes",
        "icon": "CalendarDays",
        "group": "knowledge",
        "settingsTab": "daily-notes",
        "requires": [],
        "routes": [],
    },
    {"id": "tags-page", "icon": "Hash", "group": "vault", "requires": [], "routes": []},
    {"id": "page-comments", "icon": "MessageSquare", "group": "vault", "requires": [], "routes": []},
    {"id": "share-links", "icon": "Share2", "group": "vault", "requires": [], "routes": []},
    {"id": "canvas-cards", "icon": "LayoutDashboard", "group": "vault", "requires": [], "routes": []},
    {
        "id": "web-clipper",
        "icon": "Scissors",
        "group": "connections",
        "settingsTab": "web-clipper",
        "requires": [],
        "routes": [],
    },
    {
        "id": "project-planning",
        "icon": "CalendarRange",
        "group": "knowledge",
        "settingsTab": "project-planning",
        "requires": [],
        "routes": ["/planning"],
    },
    {
        "id": "feeds-reader",
        "icon": "BookOpen",
        "group": "connections",
        "settingsTab": "reader",
        "requires": [],
        "routes": ["/reader"],
    },
    {
        "id": "translation",
        "icon": "Languages",
        "group": "knowledge",
        "settingsTab": "translate",
        "requires": [],
        "routes": [],
    },
    {
        "id": "contacts",
        "icon": "Users",
        "group": "connections",
        "settingsTab": "contacts",
        "requires": [],
        "routes": ["/contacts"],
    },
    {
        "id": "mail",
        "icon": "Inbox",
        "group": "connections",
        "settingsTab": "mail",
        "requires": [],
        "routes": ["/mail"],
    },
    {
        "id": "calendar",
        "icon": "Calendar",
        "group": "connections",
        "settingsTab": "calendar",
        "requires": [],
        "routes": ["/calendar"],
    },
    {
        "id": "social-publishing",
        "icon": "Share2",
        "group": "connections",
        "settingsTab": "social",
        "requires": [],
        "routes": ["/social-dashboard", "/composer", "/media"],
    },
    {
        "id": "notion-import",
        "icon": "Database",
        "group": "connections",
        "settingsTab": "notion",
        "requires": [],
        "routes": [],
    },
    {
        "id": "ai-platform",
        "icon": "Cpu",
        "group": "knowledge",
        "settingsTab": "ai",
        "requires": [],
        "routes": [],
    },
    {
        "id": "llm-wiki",
        "icon": "BrainCircuit",
        "group": "knowledge",
        "settingsTab": "llm-wiki",
        "requires": ["ai-platform"],
        "routes": [],
    },
    {
        "id": "grounded-notebooks",
        "icon": "NotebookTabs",
        "group": "knowledge",
        "requires": ["ai-platform"],
        "routes": ["/notebooks"],
    },
    {
        "id": "automations",
        "icon": "Clock3",
        "group": "advanced",
        "settingsTab": "automations",
        "requires": [],
        "routes": ["/scheduler"],
    },
)

BUILTIN_PLUGIN_IDS = frozenset(entry["id"] for entry in BUILTIN_PLUGINS)
BUILTIN_PLUGIN_BY_ID = {entry["id"]: entry for entry in BUILTIN_PLUGINS}


def public_registry() -> list[dict[str, Any]]:
    """Return a JSON-safe copy of the built-in capability registry."""
    return [dict(entry) for entry in BUILTIN_PLUGINS]


def normalize_state(raw: Any) -> tuple[dict[str, Any], bool]:
    """Normalize plugin state and migrate legacy state to core-only defaults."""
    data = dict(raw) if isinstance(raw, Mapping) else {}
    migrated = data.get("schema_version") != PLUGIN_STATE_VERSION

    settings = data.get("settings") if isinstance(data.get("settings"), Mapping) else {}
    granted = data.get("granted") if isinstance(data.get("granted"), Mapping) else {}
    enabled_builtin = [] if migrated else _clean_ids(data.get("enabled_builtin"), BUILTIN_PLUGIN_IDS)
    enabled_third_party = [] if migrated else _clean_ids(data.get("enabled_third_party"))

    legacy_disabled = {
        str(value) for value in (data.get("disabled") or []) if str(value).strip()
    }
    disabled = (
        legacy_disabled
        | (BUILTIN_PLUGIN_IDS - set(enabled_builtin))
        | ({plugin_id for plugin_id in legacy_disabled if plugin_id not in BUILTIN_PLUGIN_IDS})
    )
    disabled -= set(enabled_builtin)
    disabled -= set(enabled_third_party)

    normalized: dict[str, Any] = {
        **data,
        "schema_version": PLUGIN_STATE_VERSION,
        "enabled_builtin": sorted(enabled_builtin),
        "enabled_third_party": sorted(enabled_third_party),
        "disabled": sorted(disabled),
        "settings": dict(settings),
        "granted": {str(key): value for key, value in granted.items()},
    }
    if data.get("registry_url"):
        normalized["registry_url"] = str(data["registry_url"])
    return normalized, migrated or normalized != data


def is_enabled(state: Mapping[str, Any], plugin_id: str) -> bool:
    """Return explicit enablement for built-in or third-party plugins."""
    plugin_id = str(plugin_id)
    if state.get("schema_version") != PLUGIN_STATE_VERSION:
        return plugin_id not in {
            str(value) for value in (state.get("disabled") or [])
        }
    if plugin_id in BUILTIN_PLUGIN_IDS:
        return plugin_id in set(state.get("enabled_builtin") or [])
    return plugin_id in set(state.get("enabled_third_party") or [])


def required_plugins(plugin_id: str) -> tuple[str, ...]:
    """Return the transitive prerequisite list in activation order."""
    ordered: list[str] = []

    def visit(current: str) -> None:
        for requirement in BUILTIN_PLUGIN_BY_ID.get(current, {}).get("requires", []):
            visit(requirement)
            if requirement not in ordered:
                ordered.append(requirement)

    visit(plugin_id)
    return tuple(ordered)


def dependent_plugins(plugin_id: str, enabled_ids: Iterable[str]) -> tuple[str, ...]:
    """Return enabled built-ins that transitively depend on ``plugin_id``."""
    enabled = set(enabled_ids)
    dependents: list[str] = []
    changed = True
    while changed:
        changed = False
        for candidate in sorted(enabled):
            if candidate == plugin_id or candidate in dependents:
                continue
            requires = set(BUILTIN_PLUGIN_BY_ID.get(candidate, {}).get("requires", []))
            if plugin_id in requires or requires.intersection(dependents):
                dependents.append(candidate)
                changed = True
    return tuple(dependents)


def set_enabled(state: Mapping[str, Any], plugin_id: str, enabled: bool) -> dict[str, Any]:
    """Return state with one plugin's explicit enablement changed."""
    next_state, _ = normalize_state(state)
    key = "enabled_builtin" if plugin_id in BUILTIN_PLUGIN_IDS else "enabled_third_party"
    values = set(next_state.get(key) or [])
    disabled = set(next_state.get("disabled") or [])
    if enabled:
        values.add(plugin_id)
        disabled.discard(plugin_id)
    else:
        values.discard(plugin_id)
        disabled.add(plugin_id)
    next_state[key] = sorted(values)
    next_state["disabled"] = sorted(disabled)
    return next_state


def _clean_ids(values: Any, allowed: Iterable[str] | None = None) -> list[str]:
    allowed_set = set(allowed) if allowed is not None else None
    clean = {
        str(value)
        for value in (values or [])
        if str(value).strip() and (allowed_set is None or str(value) in allowed_set)
    }
    return sorted(clean)

"""Pure permission-state operations for third-party plugins."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from typing import cast


def granted_permissions(
    state: Mapping[str, object],
    plugin_id: str,
    permission_catalog: Mapping[str, str],
) -> list[str]:
    """Return known permissions currently granted to one plugin."""

    granted = cast(Mapping[str, object], state.get("granted") or {})
    values = cast(Iterable[object], granted.get(plugin_id) or [])
    return [cast(str, value) for value in values if value in permission_catalog]


def has_permission(
    state: Mapping[str, object],
    plugin_id: str,
    permission: str,
    *,
    is_enabled: Callable[[Mapping[str, object], str], bool],
    permission_catalog: Mapping[str, str],
) -> bool:
    """Return whether an active plugin owns one explicit grant."""

    if not is_enabled(state, plugin_id):
        return False
    return permission in granted_permissions(state, plugin_id, permission_catalog)


def set_granted(
    state: Mapping[str, object],
    plugin_id: str,
    permissions: Sequence[str],
    permission_catalog: Mapping[str, str],
) -> dict[str, object]:
    """Copy plugin state while replacing one plugin's normalized grants."""

    clean = [permission for permission in permissions if permission in permission_catalog]
    granted = dict(cast(Mapping[str, object], state.get("granted") or {}))
    if clean:
        granted[plugin_id] = clean
    else:
        granted.pop(plugin_id, None)
    new_state = dict(state)
    new_state["granted"] = granted
    return new_state

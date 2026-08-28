"""Plugin manifest contracts and validation."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Pattern, TypedDict, cast


class PluginError(Exception):
    """Invalid manifest or disallowed plugin operation."""


class PluginManifest(TypedDict):
    """Canonical validated third-party plugin manifest."""

    id: str
    version: str
    apiVersion: int
    name: str
    description: str
    icon: str
    main: str | None
    backend: str | None
    events: list[str]
    permissions: list[str]
    contributes: dict[str, list[str]]
    author: str
    homepage: str


def is_valid_plugin_id(value: object, pattern: Pattern[str]) -> bool:
    """Return whether a value is a safe plugin path segment."""

    return bool(value) and isinstance(value, str) and bool(pattern.match(value))


def _normalize_relative_entry(entry: object) -> str | None:
    if not entry:
        return None
    value = str(entry).strip().lstrip("/")
    if not value or ".." in value.split("/"):
        raise PluginError(f"entry invàlid: {entry!r}")
    return value


def _normalize_permissions(
    raw: object,
    permission_catalog: Mapping[str, str],
) -> list[str]:
    source = raw or []
    if not isinstance(source, list):
        raise PluginError("permissions must be a list")
    normalized: list[str] = []
    for raw_permission in cast(list[object], source):
        if raw_permission not in permission_catalog:
            raise PluginError(f"unknown permission: {raw_permission!r}")
        permission = cast(str, raw_permission)
        if permission not in normalized:
            normalized.append(permission)
    return normalized


def _normalize_events(raw: object) -> list[str]:
    source = raw or []
    if not isinstance(source, list):
        raise PluginError("events ha de ser una llista")
    return [str(event) for event in cast(list[object], source) if str(event).strip()]


def _normalize_api_version(raw: object) -> int:
    try:
        api_version = int(cast(str | bytes | bytearray | int | float, raw))
    except (TypeError, ValueError):
        raise PluginError("apiVersion ha de ser un enter")
    if api_version < 1:
        raise PluginError("apiVersion ha de ser >= 1")
    return api_version


def _normalize_contribution_entries(raw: object, key: str) -> list[str]:
    source = raw or []
    if not isinstance(source, list):
        raise PluginError(f"contributes.{key} must be a list")
    normalized: list[str] = []
    for entry in cast(list[object], source):
        relative = _normalize_relative_entry(entry)
        if relative and relative not in normalized:
            normalized.append(relative)
    return normalized


def _normalize_contributions(raw: object) -> dict[str, list[str]]:
    source = raw or {}
    if not isinstance(source, dict):
        raise PluginError("contributes must be an object")
    contribution_map = cast(Mapping[str, object], source)
    allowed = {"skills", "agents", "agentTools", "academicRepositories"}
    unknown = set(contribution_map) - allowed
    if unknown:
        raise PluginError("unknown AI contribution types: " + ", ".join(sorted(unknown)))
    normalized: dict[str, list[str]] = {}
    for key in sorted(allowed):
        entries = _normalize_contribution_entries(contribution_map.get(key), key)
        if entries:
            normalized[key] = entries
    return normalized


def _require_contribution_permissions(
    contributes: Mapping[str, list[str]],
    permissions: list[str],
    api_version: int,
    backend_entry: object,
) -> None:
    requirements = (
        ("skills", "ai:skills", "skills"),
        ("agents", "ai:agents", "agents"),
        ("agentTools", "ai:tools", "agent tools"),
        ("academicRepositories", "network", "academic repositories"),
    )
    for key, permission, label in requirements:
        if contributes.get(key) and permission not in permissions:
            raise PluginError(
                f"plugins that contribute {label} must declare the {permission} permission"
            )
    if contributes and api_version < 2:
        raise PluginError("AI contributions require plugin apiVersion 2")
    if contributes.get("agentTools") and not backend_entry:
        raise PluginError(
            "plugins that contribute agent tools must declare a sandbox backend entry"
        )
    if contributes.get("academicRepositories") and not backend_entry:
        raise PluginError(
            "plugins that contribute academic repositories must declare a sandbox backend entry"
        )


def validate_manifest(
    raw: object,
    *,
    permission_catalog: Mapping[str, str],
    plugin_id_pattern: Pattern[str],
    semver_pattern: Pattern[str],
    reserved_plugin_ids: frozenset[str],
) -> PluginManifest:
    """Validate and normalize one untrusted manifest mapping."""

    if not isinstance(raw, dict):
        raise PluginError("manifest.json must be a JSON object")
    source = cast(Mapping[str, object], raw)
    raw_plugin_id = source.get("id")
    if not is_valid_plugin_id(raw_plugin_id, plugin_id_pattern):
        raise PluginError(
            f"invalid plugin ID: {raw_plugin_id!r} (lowercase [a-z0-9_-], 2–64 characters)"
        )
    plugin_id = cast(str, raw_plugin_id)
    if plugin_id in reserved_plugin_ids:
        raise PluginError(f"plugin ID is reserved by Gnosi: {plugin_id!r}")

    version = str(source.get("version") or "0.0.0")
    if not semver_pattern.match(version):
        raise PluginError(f"invalid semantic version: {version!r}")

    permissions = _normalize_permissions(source.get("permissions"), permission_catalog)
    events = _normalize_events(source.get("events"))
    api_version = _normalize_api_version(source.get("apiVersion", 1))
    contributes = _normalize_contributions(source.get("contributes"))
    _require_contribution_permissions(
        contributes,
        permissions,
        api_version,
        source.get("backend"),
    )

    return PluginManifest(
        id=plugin_id,
        version=version,
        apiVersion=api_version,
        name=str(source.get("name") or plugin_id),
        description=str(source.get("description") or ""),
        icon=str(source.get("icon") or "Puzzle"),
        main=_normalize_relative_entry(source.get("main")),
        backend=_normalize_relative_entry(source.get("backend")),
        events=events,
        permissions=permissions,
        contributes=contributes,
        author=str(source.get("author") or ""),
        homepage=str(source.get("homepage") or ""),
    )

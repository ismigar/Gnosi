"""Additive, idempotent reference schema completion and creator-role bindings."""
from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any

from backend.domains.vault.citations.export_contracts import ReferenceProperty
from backend.services.reference_catalog import REFERENCE_CREATOR_ROLES


def property_role(prop: Mapping[Any, Any]) -> str | None:
    config = prop.get("config")
    configured = config.get("citation_role") if isinstance(config, dict) else None
    if isinstance(configured, str) and configured in REFERENCE_CREATOR_ROLES.values():
        return configured
    return REFERENCE_CREATOR_ROLES.get(str(prop.get("name") or ""))


def author_property(properties: Sequence[Any]) -> Mapping[object, object] | None:
    candidates = [p for p in properties if isinstance(p, Mapping) and p.get("type") == "autoria"]
    return next((p for p in candidates if property_role(p) == "author"), None) or next(
        (p for p in candidates if property_role(p) is None), None,
    )


def reference_property(name: str, kind: str, new_id: Callable[[], str]) -> ReferenceProperty:
    prop: ReferenceProperty = {"id": new_id(), "name": name, "type": kind}
    role = REFERENCE_CREATOR_ROLES.get(name)
    if role:
        prop["config"] = {"citation_role": role}
    return prop


def complete_properties(properties: Sequence[ReferenceProperty], schema: list[tuple[str, str]], new_id: Callable[[], str]) -> tuple[list[ReferenceProperty], int]:
    completed = [p.copy() for p in properties]
    author = author_property(completed)
    existing_roles = {property_role(p) for p in completed if p.get("type") == "autoria"}
    existing = {str(p.get("name") or "").casefold().replace(" ", "") for p in completed}
    added = 0
    for name, kind in schema:
        if (name == "Autoría" and author) or REFERENCE_CREATOR_ROLES.get(name) in existing_roles - {None}:
            continue
        normalized = name.casefold().replace(" ", "")
        if normalized not in existing:
            prop = reference_property(name, kind, new_id)
            after_role = {"Editors": "author", "Traductors": "editor"}.get(name)
            after = next((i for i, existing_prop in enumerate(completed) if after_role and property_role(existing_prop) == after_role), None)
            if after is None:
                completed.append(prop)
            else:
                completed.insert(after + 1, prop)
            existing.add(normalized)
            added += 1
    for prop in completed:
        role = property_role(prop) or ("author" if author and prop.get("id") == author.get("id") else None)
        if role:
            prop["config"] = {**(prop.get("config") or {}), "citation_role": role}
    return completed, added


def bind_roles(metadata: dict[Any, Any], properties: list[Any]) -> None:
    roles = {}
    author = author_property(properties)
    for prop in properties:
        if not isinstance(prop, dict) or prop.get("type") != "autoria":
            continue
        role = property_role(prop) or ("author" if prop is author else None)
        if role and prop.get("name"):
            roles[str(prop["name"])] = role
    if roles:
        metadata["_citation_roles"] = roles


def bind_configured_roles(metadata: dict[Any, Any], properties: object) -> None:
    """Persist role bindings only for schemas explicitly configured for citations."""
    if isinstance(properties, list) and any(
        isinstance(prop, dict) and isinstance(prop.get("config"), dict) and prop["config"].get("citation_role")
        for prop in properties
    ):
        bind_roles(metadata, properties)

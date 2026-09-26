"""Resolve assigned personal procedures without changing canonical permissions."""
from __future__ import annotations

from typing import Any


def canonical_id(identifier: str, entries: dict[str, Any]) -> str:
    seen: set[str] = set()
    while identifier in entries:
        if identifier in seen:
            raise ValueError("agent_skill_derivation_cycle")
        seen.add(identifier)
        source = entries[identifier].descriptor.metadata.get("derived_from", {}).get("id")
        if not isinstance(source, str) or not source:
            return identifier
        identifier = source
    return identifier


def effective_entries(profile: Any, entries: dict[str, Any]) -> tuple[list[str], dict[str, Any], dict[str, str]]:
    assigned = list(dict.fromkeys(profile.get("skill_ids") or []))
    aliases: dict[str, str] = {}
    overrides: dict[str, str] = dict(profile.get("skill_overrides") or {})
    for identifier in assigned:
        entry = entries.get(identifier)
        source = canonical_id(identifier, entries) if entry and entry.descriptor.metadata.get("derived_from") else None
        if source:
            if source in overrides and overrides[source] != identifier:
                raise ValueError(f"agent_skill_override_ambiguous:{source}")
            overrides[source] = identifier
    resolved = dict(entries)
    for canonical, personal in overrides.items():
        if personal not in assigned:
            raise ValueError(f"agent_skill_override_unassigned:{personal}")
        base, custom = entries.get(canonical), entries.get(personal)
        if not base or not custom or not base.available or not custom.available:
            raise ValueError(f"agent_skill_override_unavailable:{canonical}")
        if canonical_id(personal, entries) != canonical:
            raise ValueError(f"agent_skill_override_source_mismatch:{canonical}")
        # The original descriptor retains plugin lifecycle, permissions and identity.
        descriptor = base.descriptor.model_copy(update={
            "instructions": custom.descriptor.instructions,
            "version": custom.descriptor.version,
            "metadata": {**base.descriptor.metadata, "effective_skill_id": personal,
                         **({"learning": custom.descriptor.metadata["learning"]} if "learning" in custom.descriptor.metadata else {}),
                         "effective_revision": custom.revision,
                         "base_revision": base.revision},
        })
        resolved[canonical] = base.model_copy(update={"descriptor": descriptor, "revision": custom.revision})
        aliases[personal] = canonical
    return list(dict.fromkeys(aliases.get(identifier, identifier) for identifier in assigned)), resolved, aliases

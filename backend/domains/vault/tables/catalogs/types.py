"""Shared option-catalog value types."""

from __future__ import annotations

from typing import NotRequired, TypeAlias, TypedDict

from backend.domains.vault.registry.state import RegistryData

Metadata: TypeAlias = RegistryData
Seed: TypeAlias = tuple[str, str]


class Option(TypedDict):
    """Owned normalization output, unlike open plugin/registry input records."""

    name: str
    color: NotRequired[str]
    group: NotRequired[str]

__all__ = ["Metadata", "Option", "Seed"]

"""Shared in-memory types for saved-view evaluation and snapshots."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import TypeAlias

from backend.domains.vault.registry.state import RegistryData

Metadata: TypeAlias = RegistryData
Row: TypeAlias = RegistryData
Rows: TypeAlias = list[Row]
View: TypeAlias = RegistryData
Filter: TypeAlias = RegistryData
ResolveIds: TypeAlias = Callable[[str, object], list[str] | None]
ResolveTable: TypeAlias = Callable[[str, object], RegistryData | None]
ResolveTitle: TypeAlias = Callable[[str], str | None]
SnapshotConfig: TypeAlias = Callable[[str], RegistryData | None]


DecorateItem: TypeAlias = Callable[
    [object, ResolveTitle | None, ResolveTitle | None],
    object,
]


Sorts: TypeAlias = Sequence[object]

__all__ = [
    "DecorateItem",
    "Filter",
    "Metadata",
    "ResolveIds",
    "ResolveTable",
    "ResolveTitle",
    "Row",
    "Rows",
    "SnapshotConfig",
    "Sorts",
    "View",
]

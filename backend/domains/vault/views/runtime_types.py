"""Shared in-memory types for saved-view evaluation and snapshots."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any, TypeAlias

Metadata: TypeAlias = dict[str, Any]
Row: TypeAlias = dict[str, Any]
Rows: TypeAlias = list[Row]
View: TypeAlias = dict[str, Any]
Filter: TypeAlias = dict[str, Any]
ResolveIds: TypeAlias = Callable[[str, str | None], list[str] | None]
ResolveTable: TypeAlias = Callable[[str, str | None], dict[str, Any] | None]
ResolveTitle: TypeAlias = Callable[[str], str | None]
SnapshotConfig: TypeAlias = Callable[[str], dict[str, Any] | None]


DecorateItem: TypeAlias = Callable[
    [Any, ResolveTitle | None, ResolveTitle | None],
    Any,
]


Sorts: TypeAlias = Sequence[dict[str, Any]]

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

"""Lossless records consumed by citation export's legacy composition seam.

These are static views, not validators or copies. Extension metadata remains
opaque and the existing registry/page-index dictionaries retain ownership.
"""

from __future__ import annotations

from typing import TypedDict

Metadata = dict[str, object]
DedupIndexes = dict[str, dict[str, str]]


class ReferenceProperty(TypedDict, total=False):
    id: str
    name: str
    type: str
    config: Metadata
    options: list[object]


class ReferenceTable(TypedDict, total=False):
    id: str
    name: str
    properties: list[ReferenceProperty]


class ReferenceRegistry(TypedDict, total=False):
    tables: list[ReferenceTable]
    option_catalogs: Metadata


class CitationPageEntry(TypedDict, total=False):
    id: str | None
    metadata: Metadata | None
    title: str
    folder: str
    resolved_table_id: str | None

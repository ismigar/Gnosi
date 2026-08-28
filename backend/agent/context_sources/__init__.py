"""Catalogue of large searchable sources an agent can attach (phase 3).

A source of this kind is never crawled or ingested: it is queried. The BOE
publishes every morning and holds every Spanish law — no local copy can be both
complete and current, while its open API answers the precise question in one
call. Each adapter therefore exposes `search(query)` and `read(reference)`, and
the agent uses them as tools.

Adding a source = one module with ID/LABEL/DESCRIPTION/search/read, registered
in `CATALOG` below.
"""
from __future__ import annotations

from typing import Protocol

from . import boe

class SourceModule(Protocol):
    ID: str
    LABEL: str
    DESCRIPTION: str

    def search(self, query: str, limit: int = ...) -> str: ...

    def read(self, reference: str) -> str: ...


_MODULES: tuple[SourceModule, ...] = (boe,)

CATALOG: dict[str, SourceModule] = {module.ID: module for module in _MODULES}


def get_source(source_id: str) -> SourceModule | None:
    return CATALOG.get((source_id or "").strip().lower())


def list_sources() -> list[dict[str, str]]:
    """Serializable catalogue for the settings UI."""
    return [
        {"id": m.ID, "label": m.LABEL, "description": m.DESCRIPTION}
        for m in _MODULES
    ]

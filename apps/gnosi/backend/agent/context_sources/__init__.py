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

from typing import Dict, List

from . import boe

_MODULES = (boe,)

CATALOG: Dict[str, object] = {m.ID: m for m in _MODULES}


def get_source(source_id: str):
    return CATALOG.get((source_id or "").strip().lower())


def list_sources() -> List[dict]:
    """Serializable catalogue for the settings UI."""
    return [
        {"id": m.ID, "label": m.LABEL, "description": m.DESCRIPTION}
        for m in _MODULES
    ]

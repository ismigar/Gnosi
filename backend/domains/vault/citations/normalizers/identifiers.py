"""Pure DOI and ISBN normalization for citation capture."""

from __future__ import annotations

import re

DOI_RE = re.compile(r"10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)


def normalize_doi(raw: str) -> str | None:
    if not raw:
        return None
    match = DOI_RE.search(raw)
    return match.group(0) if match else None


def normalize_isbn(raw: str) -> str | None:
    if not raw:
        return None
    cleaned = re.sub(r"[-\s]", "", raw)
    match = re.search(r"97[89]\d{10}|\d{9}[\dX]", cleaned)
    return match.group(0) if match else None


__all__ = ["DOI_RE", "normalize_doi", "normalize_isbn"]

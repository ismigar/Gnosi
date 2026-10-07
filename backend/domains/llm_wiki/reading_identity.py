"""Stable reading identities: preserve source order, ignore mapping insertion order."""
from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_hash(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def identity_parts(revision: str, chunks: list[dict[str, object]], dimensions: list[dict[str, object]],
                   index: list[dict[str, object]]) -> dict[str, str]:
    return {'execution': canonical_hash(revision), 'sources': canonical_hash(chunks),
            'classification': canonical_hash(dimensions),
            'knowledge': canonical_hash(sorted(index, key=canonical_hash))}


def reading_identity(revision: str, chunks: list[dict[str, object]], dimensions: list[dict[str, object]],
                     index: list[dict[str, object]]) -> str:
    return canonical_hash(identity_parts(revision, chunks, dimensions, index))


def map_identity(revision: str, title: str, language: str, material: Any) -> str:
    # Source maps do not use the knowledge index or classification properties.
    # Changing those cannot invalidate a complete source-only map.
    return canonical_hash([1, revision, title, language, material])

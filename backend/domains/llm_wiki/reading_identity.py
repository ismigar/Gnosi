"""Stable reading identities: preserve source order, ignore mapping insertion order."""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy
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


def resume_semantic_state(saved: object, identity: str, parts: dict[str, str],
                          context: str) -> dict[str, Any] | None:
    """Keep source-grounded drafts after index changes, requiring a fresh review."""
    if not isinstance(saved, dict) or saved.get("engine") != 2 or saved.get("reading_context") != context:
        return None
    if saved.get("identity") == identity:
        return deepcopy(saved)
    previous = saved.get("identity_parts")
    if not isinstance(previous, dict) or not all(
        parts.get(key) and previous.get(key) == parts[key]
        for key in ("execution", "sources", "classification")
    ):
        return None
    restored = deepcopy(saved)
    restored.update(identity=identity, identity_parts=parts, completed=False,
                    previous_reviewed_groups=restored.get("reviewed_groups", {}),
                    reviewed_groups={}, reviewed_ranges={}, knowledge_context_changed=True)
    return restored


def map_identity(revision: str, title: str, language: str, material: Any) -> str:
    # Source maps do not use the knowledge index or classification properties.
    # Changing those cannot invalidate a complete source-only map.
    return canonical_hash([1, revision, title, language, material])

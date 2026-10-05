"""Restore only unambiguous omitted segment digests; never rewrite evidence."""
from __future__ import annotations

import re
from typing import Any

from backend.domains.llm_wiki.chunking import records


def _aliases(segments: list[dict[str, object]]) -> dict[str, str]:
    candidates: dict[str, set[str]] = {}
    for segment in segments:
        identifier = str(segment["id"])
        match = re.fullmatch(r"([0-9a-f]{16}-s\d+)-[0-9a-f]{8}", identifier)
        if match:
            candidates.setdefault(match[1], set()).add(identifier)
    return {alias: next(iter(ids)) for alias, ids in candidates.items() if len(ids) == 1}


def _replace(owner: dict[str, Any], key: str, aliases: dict[str, str]) -> int:
    value = owner.get(key)
    if isinstance(value, str) and value in aliases:
        owner[key] = aliases[value]
        return 1
    return 0


def _rows(value: object) -> list[dict[str, Any]]:
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def normalize_action_references(answer: dict[str, object], chunks: dict[str, Any], read: list[str]) -> int:
    """Canonicalize known references in place, before the unchanged evidence gates."""
    args = answer.get("arguments")
    if not isinstance(args, dict):
        return 0
    if answer.get("action") == "save_plan":
        entries = [args]
    elif answer.get("action") == "save_batch":
        entries = _rows(args.get("plans"))
    else:
        return 0
    evidence = _aliases([s for key in read for s in records(chunks[key].get("segments"))])
    changes = 0
    for entry in entries:
        key = entry.get("chunk_id")
        plan = entry.get("plan")
        if not isinstance(key, str) or key not in read or not isinstance(plan, dict):
            continue
        primary = _aliases(records(chunks[key].get("segments")))
        for row in _rows(plan.get("coverage")):
            changes += _replace(row, "segment_id", primary)
        for note in _rows(plan.get("notes")):
            changes += _replace(note, "source_segment_id", primary)
            for citation in _rows(note.get("citations")):
                changes += _replace(citation, "segment_id", evidence)
    return changes

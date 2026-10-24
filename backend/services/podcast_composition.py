"""Require explicit prose for every planned group under one episode word budget."""
from __future__ import annotations

from typing import Any

from backend.services.podcast_briefing import _object


def schema(data: dict[str, Any]) -> dict[str, Any]:
    groups = data.get("composition_groups", [])
    if not groups:
        return _object({"narration": {"type": "string", "minLength": 1}})
    block = _object({"text": {"type": "string"}, "non_editorial": {"type": "boolean"}})
    return _object({"paragraphs": _object({g["key"]: block for g in groups})})


def spoken_text(result: dict[str, Any], data: dict[str, Any]) -> str:
    groups = data.get("composition_groups", [])
    if not groups:
        return str(result["narration"])
    paragraphs = []
    for group in groups:
        block = result["paragraphs"][group["key"]]
        text = block["text"].strip()
        if bool(text) == block["non_editorial"]:
            raise ValueError("podcast_group_requires_prose_or_explicit_non_editorial_exclusion")
        if text:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)

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


def advisory_targets(words: int, weights: dict[str, int], *, minimum: int = 0) -> dict[str, int]:
    """Apportion a shared target exactly; these shares are never acceptance caps."""
    if not weights:
        return {}
    keys = list(weights)
    values = [max(0, weights[key]) for key in keys]
    if not any(values):
        values = [1] * len(keys)
    floor = min(minimum, words // len(keys))
    remaining = words - floor * len(keys)
    total = sum(values)
    shares = [divmod(remaining * value, total) for value in values]
    targets = [floor + quotient for quotient, _ in shares]
    order = sorted(range(len(keys)), key=lambda i: (-shares[i][1], i))
    for index in order[:words - sum(targets)]:
        targets[index] += 1
    return dict(zip(keys, targets, strict=True))


def word_guidance(result: dict[str, Any], data: dict[str, Any], words: int) -> dict[str, Any]:
    groups = data.get("composition_groups", [])
    if not groups:
        return {}
    counts = {g["key"]: len(result["paragraphs"][g["key"]]["text"].split()) for g in groups}
    targets = advisory_targets(words, counts)
    return {"paragraph_word_guidance": {key: {"current": count, "suggested": targets[key]}
                                         for key, count in counts.items()}}

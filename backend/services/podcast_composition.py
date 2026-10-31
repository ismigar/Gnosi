"""Require explicit prose for every planned group under one episode word budget."""
from __future__ import annotations

from typing import Any

from backend.services.podcast_briefing import _object


WORD_TOKENS = "word_tokens_v1"
WORD_TEXT = "word_text_v1"
BOUNDED_TEXT = "bounded_word_text_v1"
MARKER_PREFIX = "__gnosi_group__:"


def schema(data: dict[str, Any]) -> dict[str, Any]:
    groups = data.get("composition_groups", [])
    if not groups:
        return _object({"narration": {"type": "string", "minLength": 1}})
    if data.get("composition_encoding") in {WORD_TOKENS, WORD_TEXT, BOUNDED_TEXT}:
        bounds = data["composition_word_range"]
        minimum, maximum = bounds["min_words"], bounds["max_words"]
        if not (type(minimum) is int and type(maximum) is int and 0 < minimum <= maximum):
            raise ValueError("podcast_composition_word_range_invalid")
        flags = _object({g["key"]: _object({"non_editorial": {"type": "boolean"}}) for g in groups})
        if data["composition_encoding"] in {WORD_TEXT, BOUNDED_TEXT}:
            text: dict[str, Any] = {"type": "string", "minLength": 1}
            if data["composition_encoding"] == BOUNDED_TEXT:
                # All ordered markers are independently verified by the decoder.
                # A single compact stream shares the same global spoken range.
                text["pattern"] = rf"^\S+(?:\s+\S+){{{minimum + len(groups) - 1},{maximum + len(groups) - 1}}}$"
            return _object({"paragraphs": flags, "token_text": text})
        return _object({"paragraphs": flags, "tokens": {"type": "array",
            "minItems": minimum + len(groups), "maxItems": maximum + len(groups),
            "items": {"type": "string", "pattern": r"^\S+$"}}})
    block = _object({"text": {"type": "string"}, "non_editorial": {"type": "boolean"}})
    return _object({"paragraphs": _object({g["key"]: block for g in groups})})


def _stream_items(result: dict[str, Any]) -> list[Any] | None:
    """Select the complete transport without changing its words or legacy shape."""
    if "token_text" in result:
        if "tokens" in result or not isinstance(result["token_text"], str):
            raise ValueError("podcast_composition_tokens_invalid")
        return result["token_text"].split()
    if "tokens" not in result:
        return None
    tokens = result["tokens"]
    if not isinstance(tokens, list):
        raise ValueError("podcast_composition_tokens_invalid")
    return tokens


def composition_blocks(result: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    """Decode every spoken word without truncating or allocating per-group caps."""
    paragraphs = result.get("paragraphs")
    if not isinstance(paragraphs, dict):
        raise ValueError("podcast_composition_paragraphs_invalid")
    groups = data["composition_groups"]
    if set(paragraphs) != {group["key"] for group in groups}:
        raise ValueError("podcast_composition_paragraphs_invalid")
    for block in paragraphs.values():
        if not isinstance(block, dict) or type(block.get("non_editorial")) is not bool:
            raise ValueError("podcast_composition_paragraphs_invalid")
    tokens = _stream_items(result)
    if tokens is None:
        if any(not isinstance(block.get("text"), str) for block in paragraphs.values()):
            raise ValueError("podcast_composition_paragraphs_invalid")
        return paragraphs
    markers = {MARKER_PREFIX + group["key"]: index for index, group in enumerate(groups)}
    words: list[list[str]] = [[] for _ in groups]
    current = -1
    for token in tokens:
        if not isinstance(token, str) or not token or any(c.isspace() for c in token):
            raise ValueError("podcast_composition_token_requires_one_word")
        if token in markers:
            if markers[token] != current + 1:
                raise ValueError("podcast_composition_group_markers_out_of_order")
            current += 1
        elif token.startswith(MARKER_PREFIX) or current < 0:
            raise ValueError("podcast_composition_group_marker_invalid")
        else:
            words[current].append(token)
    if current != len(groups) - 1:
        raise ValueError("podcast_composition_group_marker_missing")
    return {group["key"]: {"text": " ".join(words[index]),
            "non_editorial": result["paragraphs"][group["key"]]["non_editorial"]}
            for index, group in enumerate(groups)}


def spoken_text(result: dict[str, Any], data: dict[str, Any]) -> str:
    groups = data.get("composition_groups", [])
    if not groups:
        return str(result["narration"])
    blocks = composition_blocks(result, data)
    paragraphs = []
    for group in groups:
        block = blocks[group["key"]]
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
    blocks = composition_blocks(result, data)
    counts = {g["key"]: len(blocks[g["key"]]["text"].split()) for g in groups}
    targets = advisory_targets(words, counts)
    return {"paragraph_word_guidance": {key: {"current": count, "suggested": targets[key]}
                                         for key, count in counts.items()}}

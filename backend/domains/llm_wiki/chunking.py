"""Structure-aware, bounded primary chunks with separately labelled neighbours."""

from __future__ import annotations

import json
import re
from collections.abc import Callable

from backend.domains.vault.registry.records import is_record
from backend.utils.open_values import integer_value


def record(value: object) -> dict[str, object]:
    return {str(key): item for key, item in value.items()} if is_record(value) else {}


def records(value: object) -> list[dict[str, object]]:
    return [record(item) for item in value if is_record(item)] if isinstance(value, list) else []


def encoded(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def split_segment(
    segment: dict[str, object], budget: int, count: Callable[[str], int]
) -> list[dict[str, object]]:
    text = str(segment.get("text") or "")
    if count(encoded(segment)) <= budget:
        return [segment]
    parts: list[dict[str, object]] = []
    start = 0
    offset = integer_value(record(segment.get("locator")).get("char_start") or 0)
    while start < len(text):
        low, high = start + 1, len(text)

        def part(end: int) -> dict[str, object]:
            return {
                **segment,
                "text": text[start:end],
                "locator": {
                    **record(segment.get("locator")),
                    "char_start": offset + start,
                    "char_end": offset + end,
                },
            }

        if count(encoded(part(low))) > budget:
            raise RuntimeError("A source locator exceeds the reading context budget")
        while low < high:
            mid = (low + high + 1) // 2
            if count(encoded(part(mid))) <= budget:
                low = mid
            else:
                high = mid - 1
        end = low
        if end < len(text):
            # Prefer sentence/line boundaries, then word boundaries, before a hard cut.
            window = text[start:end]
            boundaries = [match.end() for match in re.finditer(r"[.!?]\s+|\n+", window)]
            if not boundaries:
                boundaries = [match.end() for match in re.finditer(r"\s+", window)]
            if boundaries and boundaries[-1] >= len(window) // 2:
                end = start + boundaries[-1]
        parts.append(part(end))
        start = end
    return parts


def _section(segment: dict[str, object]) -> str:
    locator = record(segment.get("locator"))
    return str(locator.get("section") or locator.get("chapter") or "")


def reading_chunks(
    origins: list[dict[str, object]], *, budget: int, count: Callable[[str], int]
) -> list[dict[str, object]]:
    chunks: list[dict[str, object]] = []
    for origin in origins:
        local: list[dict[str, object]] = []
        current: list[dict[str, object]] = []

        def flush() -> None:
            nonlocal current
            if current:
                local.append(
                    {
                        "id": f"chunk-{len(chunks) + len(local) + 1}",
                        "origin_id": origin["origin_id"],
                        "origin_label": origin.get("label", ""),
                        "kind": origin.get("kind", ""),
                        "section": _section(current[0]),
                        "segments": current,
                    }
                )
                current = []

        for raw in records(origin.get("segments")):
            for segment in split_segment(raw, max(256, budget - 512), count):
                if current and (
                    _section(segment) != _section(current[-1])
                    or count(encoded(current + [segment])) > budget - 256
                ):
                    flush()
                current.append(segment)
        flush()
        for index, chunk in enumerate(local):
            neighbours = []
            if index:
                neighbours.append(records(local[index - 1]["segments"])[-1])
            if index + 1 < len(local):
                neighbours.append(records(local[index + 1]["segments"])[0])
            # Full original ids/locators are retained even for bounded previews.
            chunk["context_segments"] = [
                split_segment(segment, max(256, budget // 4), count)[-1 if i == 0 and index else 0]
                for i, segment in enumerate(neighbours)
            ]
        chunks.extend(local)
    return chunks

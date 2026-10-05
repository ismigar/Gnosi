"""Deterministic grouping and lexical retrieval over immutable reading evidence."""
from __future__ import annotations

import math
import re
from collections import Counter
from collections.abc import Callable
from typing import Any

from backend.domains.llm_wiki.chunking import encoded, records


def source_view(segment: dict[str, object]) -> dict[str, object]:
    return {"text": segment["text"], "location": segment.get("locator", {}), "document": segment.get("origin_label", "")}


def chunk_view(chunk: dict[str, object]) -> dict[str, object]:
    return {"document": chunk.get("origin_label"),
            "passages": [source_view(s) for s in records(chunk.get("segments"))]}


def groups(values: list[Any], count: Callable[[str], int], limit: int,
           maximum: int = 1000000) -> list[list[Any]]:
    result: list[list[Any]] = []
    for value in values:
        if count(encoded([value])) > limit:
            raise RuntimeError("A reading item exceeds the selected model's context budget")
        if not result or len(result[-1]) >= maximum or count(encoded([*result[-1], value])) > limit:
            result.append([])
        result[-1].append(value)
    return result


def overview_groups(chunks: list[dict[str, object]], count: Callable[[str], int], budget: int) -> list[list[Any]]:
    # Larger source-only windows give the overview continuity without inflating
    # the detailed note response. All passages participate, including the ending.
    return groups([chunk_view(c) for c in chunks], count, max(2000, budget // 3))


def terms(text: str) -> set[str]:
    return {word for word in re.findall(r"\w+", text.casefold()) if len(word) > 3}


def relevant(values: list[dict[str, object]], query: str, count: Callable[[str], int], limit: int,
             *, text_key: str = "text") -> list[dict[str, object]]:
    """Inverse document frequency reduces dominance of repeated generic words."""
    wordsets = [terms(str(row.get(text_key, ""))) for row in values]
    frequencies = Counter(word for words in wordsets for word in words)
    requested = terms(query)
    scores = [sum(math.log(1 + len(values) / frequencies[word]) for word in words & requested)
              for words in wordsets]
    ranked = sorted(range(len(values)), key=lambda i: (-scores[i], i))
    result: list[dict[str, object]] = []
    for index in ranked:
        if scores[index] and count(encoded([*result, values[index]])) <= limit:
            result.append(values[index])
    return result


def reading_context(chunks: list[dict[str, object]], selected: list[dict[str, object]],
                    plans: dict[str, Any], count: Callable[[str], int], budget: int) -> dict[str, object]:
    primary = [s for c in selected for s in records(c.get("segments"))]
    query = " ".join(str(s["text"]) for s in primary)
    excluded = {s["id"] for s in primary}
    neighbours = list({str(s["id"]): {**s, "origin_label": c.get("origin_label")} for c in selected
                       for s in records(c.get("context_segments")) if s["id"] not in excluded}.values())
    excluded.update(s["id"] for s in neighbours)
    originals = [{**s, "origin_label": c.get("origin_label")} for c in chunks for s in records(c.get("segments"))
                 if s["id"] not in excluded]
    retrieved = relevant(originals, query, count, budget // 10)
    prior = [dict(n, text=str(n.get("title", "")) + " " + str(n.get("body_md", "")))
             for plan in plans.values() for n in records(plan.get("notes"))]
    notes = relevant(prior, query, count, budget // 12)
    return {"evidence": [*primary, *neighbours, *retrieved],
            "neighbours": [source_view(s) for s in neighbours],
            "retrieved_originals": [source_view(s) for s in retrieved],
            "related_notes": [{"title": n.get("title"), "body_md": n.get("body_md")} for n in notes]}


def state_progress(state: dict[str, Any]) -> tuple[int, ...]:
    return (len(state.get("plans", {})), len(state.get("reviewed_groups", {})),
            int(bool(state.get("notes_map"))), int(bool(state.get("global_map"))), len(state.get("maps", [])))

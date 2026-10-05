"""Offline phase estimates for the deterministic reader, including joint review."""
from __future__ import annotations

import math
from typing import Any

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_context import chunk_view, groups, overview_groups
from backend.domains.llm_wiki.semantic_contracts import interpretation_schema


def phase_estimate(runtime: Any, chunks: list[dict[str, object]], remaining: list[dict[str, object]],
                   dimensions: list[dict[str, object]], saved: dict[str, Any], batch_size: int) -> dict[str, Any]:
    budget = runtime.input_budget
    overview_count = len(overview_groups(chunks, runtime.count_tokens, budget))
    overview = max(0, overview_count - len(saved.get("overview_complete", {})))
    # Summary reduction levels depend on the actual generated maps. Count their
    # maximum requested size here; no paid call is made by the estimate.
    map_size = max(350, min(2000, budget // 24))
    fan_in = max(2, budget // (3 * (map_size + 512)))
    synthesis = 0
    count = overview_count
    while count > 1:
        count = math.ceil(count / fan_in)
        synthesis += count
    if saved.get("global_map"):
        synthesis = 0
    extract = len(groups([chunk_view(c) for c in remaining], runtime.count_tokens, budget // 5, batch_size))
    source = sum(len(encoded(chunk_view(c)).encode()) for c in chunks)
    pending = sum(len(encoded(chunk_view(c)).encode()) for c in remaining)
    expected_notes = source // 2
    note_maps = math.ceil(expected_notes / max(1, budget // 3)) + 1 if not saved.get("notes_map") else 0
    review = max(0, math.ceil((2 * source + expected_notes) / max(1, budget // 3)) - len(saved.get("reviewed_groups", {})))
    calls = overview + synthesis + extract + note_maps + review
    schema = interpretation_schema(1, dimensions)
    # The requested summary length is a target, not a discard threshold.
    # Reserve for both retained source and joint-note maps in a review prompt.
    repeated = calls * (2 * len(runtime.instructions.encode()) + 3 * len(encoded(schema).encode()) + 2 * max(2000, budget // 8) + 2048)
    inputs = 2 * pending + (source if overview else 0) + 2 * source * bool(review) + expected_notes * bool(note_maps) + repeated
    return {"planned_calls": calls, "memory_restore_calls": 0, "input_token_bound": inputs,
            "output_tokens_assumed": pending // 2 + map_size * (overview + synthesis + note_maps) + 512 * (extract + review),
            "output_token_bound": 16384 * calls,
            "reading_engine": "semantic", "phase_calls": {"overview": overview + synthesis, "interpretation": extract,
                                                            "joint_map": note_maps, "review": review}}

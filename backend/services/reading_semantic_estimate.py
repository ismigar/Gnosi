"""Offline phase estimates for the deterministic reader, including joint review."""
from __future__ import annotations

from backend.domains.llm_wiki.reading_quality import REVIEW_QUALITY_VERSION

import math
from typing import Any

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.semantic_context import chunk_view, groups, overview_groups
from backend.domains.llm_wiki.semantic_contracts import interpretation_schema
from backend.domains.llm_wiki.semantic_map_reduction import map_limit, reduction_groups


def phase_estimate(runtime: Any, chunks: list[dict[str, object]], remaining: list[dict[str, object]],
                   dimensions: list[dict[str, object]], saved: dict[str, Any], batch_size: int) -> dict[str, Any]:
    budget = runtime.input_budget
    overview_count = len(overview_groups(chunks, runtime.count_tokens, budget))
    overview = max(0, overview_count - len(saved.get("overview_complete", {})))
    # Summary reduction levels depend on the actual generated maps. Count their
    # maximum requested size here; no paid call is made by the estimate.
    map_size = map_limit(budget)
    fan_in = max(2, budget // (3 * (map_size + 512)))
    synthesis = 0
    count = overview_count
    if saved.get("maps") and not overview:
        maps = saved["maps"]
        # Existing full source maps are preserved, but only their bounded
        # syntheses recur in interpretation/review. Price the first contraction
        # from the actual saved window sizes, not the original window count.
        count = len(reduction_groups(maps, runtime.count_tokens, budget // 3))
        synthesis = count if len(maps) > 1 or runtime.count_tokens(maps[0]) > map_size else 0
    while count > 1:
        count = math.ceil(count / fan_in)
        synthesis += count
    if saved.get("global_map") and runtime.count_tokens(saved["global_map"]) <= map_size:
        synthesis = 0
    extract = len(groups([chunk_view(c) for c in remaining], runtime.count_tokens, budget // 5, batch_size))
    source = sum(len(encoded(chunk_view(c)).encode()) for c in chunks)
    pending = sum(len(encoded(chunk_view(c)).encode()) for c in remaining)
    expected_notes = source // 2
    known_notes = [note for plan in saved.get("plans", {}).values() for note in plan.get("notes", [])]
    if known_notes:
        expected_notes = max(expected_notes, len(encoded(known_notes).encode()))
    note_maps = math.ceil(expected_notes / max(1, budget // 3)) + 1 if not saved.get("notes_map") else 0
    planned_reviews = math.ceil((2 * source + expected_notes) / max(1, budget // 3))
    if known_notes and saved.get("review_size_limit"):
        planned_reviews = max(planned_reviews, math.ceil(len(known_notes) / max(1, saved["review_size_limit"])))
    valid_reviews = len(saved.get("reviewed_groups", {})) if saved.get("review_quality_version") == REVIEW_QUALITY_VERSION else 0
    review = max(0, planned_reviews - valid_reviews)
    calls = overview + synthesis + extract + note_maps + review
    schema = interpretation_schema(1, dimensions)
    # Full source maps stay in checkpoints. Only the two contracted navigation
    # maps recur in interpretation/review; originals remain separately priced.
    repeated = calls * (2 * len(runtime.instructions.encode()) + 3 * len(encoded(schema).encode()) + 2 * map_size + 2048)
    inputs = 2 * pending + (source if overview else 0) + 2 * source * bool(review) + expected_notes * bool(note_maps) + repeated + 4000 * review
    return {"planned_calls": calls, "memory_restore_calls": 0, "input_token_bound": inputs,
            "output_tokens_assumed": pending // 2 + map_size * (overview + synthesis + note_maps) + 512 * (extract + review),
            "output_token_bound": 8192 * (overview + synthesis + note_maps) + 16384 * (extract + review),
            "reading_engine": "semantic", "phase_calls": {"overview": overview + synthesis, "interpretation": extract,
                                                            "joint_map": note_maps, "review": review}}

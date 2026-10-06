"""Source-grounded joint review with sparse semantic replacements, never a rewrite loop."""
from __future__ import annotations

from copy import deepcopy
from typing import TYPE_CHECKING

from backend.domains.llm_wiki.chunking import encoded, records
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_contracts import semantic_note

if TYPE_CHECKING:
    from backend.domains.llm_wiki.semantic_reading import SemanticReader


def review_plans(engine: SemanticReader, global_map: str, notes_map: str) -> list[tuple[dict[str, object], dict[str, object]]]:
    reader = engine.reader
    reviewed = [(chunk, deepcopy(engine.state["plans"][str(chunk["id"])])) for chunk in reader.chunks]
    entries: list[dict[str, object]] = []
    destinations = []
    for ci, (chunk, plan) in enumerate(reviewed):
        for ni, note in enumerate(records(plan.get("notes"))):
            primary = {**next(s for s in records(chunk.get("segments")) if s["id"] == note["source_segment_id"]),
                       "origin_label": chunk.get("origin_label")}
            cited = {c["segment_id"] for c in records(note.get("citations"))}
            support = [s for s in records(plan.get("evidence_segments")) if s["id"] in cited and s != primary]
            entries.append({"note": semantic_note(note, reader.dimensions), "primary": source_view(primary),
                            "support": [source_view(s) for s in support]})
            destinations.append((ci, ni, note, primary, [primary, *support]))
    from backend.domains.llm_wiki.semantic_review_execution import review_batches
    for batch, validated in review_batches(engine, entries, destinations, global_map, notes_map):
        for (ci, ni, _, _, _), note in zip(batch.targets, validated, strict=True):
            updated = records(reviewed[ci][1]["notes"])
            updated[ni] = note
            reviewed[ci][1]["notes"] = updated
        for ci in {target[0] for target in batch.targets}:
            evidence = [*records(reviewed[ci][1].get("evidence_segments")), *batch.evidence]
            reviewed[ci][1]["evidence_segments"] = list({encoded(s): s for s in evidence}.values())
    for chunk, plan in reviewed:
        from backend.domains.llm_wiki.reading_contracts import validate_notes
        from backend.domains.llm_wiki.reading_action_contracts import validate_note_dimensions
        validate_notes(plan, records(chunk.get("segments")), records(plan.get("evidence_segments")))
        validate_note_dimensions(plan, reader.dimensions)
        warnings = plan.get("warnings", [])
        if isinstance(warnings, list):
            reader.warnings.extend(str(w) for w in warnings if isinstance(w, str))
    return reviewed

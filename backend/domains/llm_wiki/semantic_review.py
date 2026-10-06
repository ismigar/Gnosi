"""Source-grounded joint review with sparse semantic replacements, never a rewrite loop."""
from __future__ import annotations

from copy import deepcopy
from typing import TYPE_CHECKING

from backend.domains.llm_wiki.chunking import encoded, records
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.semantic_contracts import semantic_note
from backend.domains.llm_wiki.reading_quality import REVIEW_QUALITY_VERSION, adjacent_originals, prose_issues


if TYPE_CHECKING:
    from backend.domains.llm_wiki.semantic_reading import SemanticReader


def review_plans(engine: SemanticReader, global_map: str, notes_map: str) -> list[tuple[dict[str, object], dict[str, object]]]:
    reader = engine.reader
    if engine.state.get("review_quality_version") != REVIEW_QUALITY_VERSION:
        # Retain the paid interpretations and maps, but an earlier review did
        # not check prose integrity or unresolved evidence. Never certify it.
        engine.state["previous_reviewed_groups"] = engine.state.get("reviewed_groups", {})
        engine.state["reviewed_groups"] = {}
        engine.state["reviewed_ranges"] = {}
        engine.state["review_quality_version"] = REVIEW_QUALITY_VERSION
        engine.state["completed"] = False
        engine.save()
    reviewed = [(chunk, deepcopy(engine.state["plans"][str(chunk["id"])])) for chunk in reader.chunks]
    neighbours = adjacent_originals(reader.chunks)
    entries: list[dict[str, object]] = []
    destinations = []
    for ci, (chunk, plan) in enumerate(reviewed):
        if records(plan.get("notes")):
            plan["prior_warnings"] = list(dict.fromkeys(str(w) for w in plan.get("warnings", []) if isinstance(w, str)))
            plan["warnings"] = []
        for ni, note in enumerate(records(plan.get("notes"))):
            primary = {**next(s for s in records(chunk.get("segments")) if s["id"] == note["source_segment_id"]),
                       "origin_label": chunk.get("origin_label")}
            cited = {c["segment_id"] for c in records(note.get("citations"))}
            support = [s for s in records(plan.get("evidence_segments")) if s["id"] in cited and s != primary]
            support = list({encoded(s): s for s in [*support, *neighbours.get(str(primary["id"]), [])]}.values())
            entries.append({"note": semantic_note(note, reader.dimensions), "primary": source_view(primary),
                            "support": [source_view(s) for s in support],
                            "prior_observations": plan.get("prior_warnings", []),
                            "validation_issues": prose_issues(note, [primary, *support], reader.language)})
            destinations.append((ci, ni, note, primary, [primary, *support]))
    from backend.domains.llm_wiki.semantic_review_execution import review_batches
    for batch, validated in review_batches(engine, entries, destinations, global_map, notes_map):
        for (ci, ni, _, _, _), note in zip(batch.targets, validated, strict=True):
            updated = records(reviewed[ci][1]["notes"])
            updated[ni] = note
            reviewed[ci][1]["notes"] = updated
        for ci in {target[0] for target in batch.targets}:
            warnings = engine.state["reviewed_groups"][batch.key]["warnings"]
            reviewed[ci][1]["warnings"] = list(dict.fromkeys([*reviewed[ci][1]["warnings"], *warnings]))
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

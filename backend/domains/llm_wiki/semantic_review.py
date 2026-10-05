"""Source-grounded joint review with sparse semantic replacements, never a rewrite loop."""
from __future__ import annotations

from copy import deepcopy
from typing import TYPE_CHECKING

from backend.domains.llm_wiki.chunking import encoded, records
from backend.domains.llm_wiki.contextual_reading import fingerprint
from backend.domains.llm_wiki.semantic_context import groups, relevant, source_view
from backend.domains.llm_wiki.reading_batch_recovery import _has_answer_tokens
from backend.domains.llm_wiki.semantic_contracts import bind_review, fields, review_schema, semantic_note

if TYPE_CHECKING:
    from backend.domains.llm_wiki.semantic_reading import SemanticReader


def review_plans(engine: SemanticReader, global_map: str, notes_map: str) -> list[tuple[dict[str, object], dict[str, object]]]:
    reader = engine.reader
    reviewed = [(chunk, deepcopy(engine.state["plans"][str(chunk["id"])])) for chunk in reader.chunks]
    entries = []
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
    offset = 0
    while offset < len(entries):
        maximum = engine.state.get("review_size_limit", len(entries))
        batch = groups(entries[offset:], engine.deps.count_tokens, reader.budget // 3, maximum)[0]
        previous_size = engine.state.get("reviewed_ranges", {}).get(str(offset))
        if previous_size and fingerprint(entries[offset:offset + previous_size]) in engine.state["reviewed_groups"]:
            batch = entries[offset:offset + previous_size]
        targets = destinations[offset:offset + len(batch)]
        original = [{**s, "origin_label": c.get("origin_label")} for c in reader.chunks for s in records(c.get("segments"))]
        retrieved = relevant(original, encoded(batch), engine.deps.count_tokens, reader.budget // 10)
        evidence_targets = [(n, p, [*e, *retrieved]) for _, _, n, p, e in targets]
        key = fingerprint(batch)
        reader.phase("reviewing", 55 + round(18 * offset / max(1, len(entries))))
        if key not in engine.state["reviewed_groups"]:
            schema = review_schema(len(batch), reader.dimensions)
            def validate(answer: dict[str, object]) -> None:
                bind_review(answer, evidence_targets, reader.dimensions)
            try:
                answer = engine.ask(f"semantic-review-{key[:20]}", "verify", {
                    "global_map": global_map, "all_notes_map": notes_map, "notes": batch,
                    "retrieved_originals": [source_view(s) for s in retrieved],
                    "properties": fields(reader.dimensions),
                    "instruction": "Review EVERY supplied note against its original evidence and the joint map of ALL notes. Correct false attribution, missing caveats, contradicted conclusions and unsupported links. Return only changed notes with their one-based position; unchanged notes are retained by the application. Preserve distinct ideas. Do not remove notes or change workflow state. New quotes must be exact originals and include the note's own primary passage. An empty changes list means you found no needed correction, not that accuracy is guaranteed."}, schema, validate)
            except Exception as error:
                if len(batch) <= 1 or not _has_answer_tokens(error):
                    raise
                engine.state["review_size_limit"] = max(1, len(batch) // 2)
                engine.save()
                continue
            engine.state["reviewed_groups"][key] = answer
            engine.state.setdefault("reviewed_ranges", {})[str(offset)] = len(batch)
            engine.save()
        answer = engine.state["reviewed_groups"][key]
        validated = bind_review(answer, evidence_targets, reader.dimensions)
        reader.warnings.extend(str(w) for w in answer["warnings"])
        for (ci, ni, _, _, _), note in zip(targets, validated, strict=True):
            updated = records(reviewed[ci][1]["notes"])
            updated[ni] = note
            reviewed[ci][1]["notes"] = updated
            # Preserve newly retrieved supporting originals for the reducer.
            reviewed[ci][1]["evidence_segments"] = [*records(reviewed[ci][1].get("evidence_segments")), *retrieved]
        offset += len(batch)
    for chunk, plan in reviewed:
        from backend.domains.llm_wiki.reading_contracts import validate_notes
        from backend.domains.llm_wiki.reading_action_contracts import validate_note_dimensions
        validate_notes(plan, records(chunk.get("segments")), records(plan.get("evidence_segments")))
        validate_note_dimensions(plan, reader.dimensions)
        warnings = plan.get("warnings", [])
        if isinstance(warnings, list):
            reader.warnings.extend(str(w) for w in warnings if isinstance(w, str))
    return reviewed

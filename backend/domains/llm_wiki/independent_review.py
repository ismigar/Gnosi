"""Selective review of original passages after the reader has checked its drafts."""
from __future__ import annotations

from dataclasses import replace
from collections.abc import Callable
from typing import Any, TYPE_CHECKING

from backend.domains.llm_wiki.chunking import encoded, record, records
from backend.domains.llm_wiki.contextual_reading import fingerprint
from backend.domains.llm_wiki.reading_quality import adjacent_originals, validate_boundary_coverage, validate_reviewed_prose
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.review_selection import passage_key, selected_passages
from backend.domains.llm_wiki.semantic_contracts import (
    TEXT, TEXTS, bind_note, fields, note_schema, obj, semantic_note, validate_schema,
)

if TYPE_CHECKING:
    from backend.domains.llm_wiki.contextual_reading import ContextualReader
    from backend.domains.llm_wiki.ingestion import ReviewRuntime
    from backend.domains.llm_wiki.semantic_reading import SemanticReader

def audit_schema(size: int, dimensions: list[dict[str, object]]) -> dict[str, Any]:
    replacement = note_schema(dimensions)
    replacement["properties"].pop("quote_source_keys", None)  # Provenance is bound locally.
    change = obj({"position": {"type": "integer", "minimum": 0, "maximum": size},
                  "reason": TEXT, "replacement": {"anyOf": [replacement, {"type": "null"}]}})
    return obj({"assessment": TEXT, "evidence_quote": TEXT, "unresolved_issues": TEXTS, "changes": {"type": "array", "items": change}})


def apply_changes(answer: dict[str, object], drafts: list[dict[str, object]], primary: dict[str, object],
                  evidence: list[dict[str, object]], dimensions: list[dict[str, object]]) -> list[dict[str, object]]:
    validate_schema(answer, audit_schema(len(drafts), dimensions))
    if answer["unresolved_issues"]:
        raise ValueError("The independent reviewer must resolve outstanding source issues before acceptance")
    quote = str(answer["evidence_quote"])
    if not quote.strip() or quote not in str(primary["text"]):
        raise ValueError("The assessment must cite an exact quotation from the primary passage")
    if not str(answer["assessment"]).strip():
        raise ValueError("Explain what the evidence establishes")
    validate_boundary_coverage(answer["assessment"])
    revised: list[dict[str, object] | None] = list(drafts)
    replaced: set[int] = set()
    for change in records(answer["changes"]):
        position = int(str(change["position"]))
        if position and position in replaced:
            raise ValueError("Only one correction per existing note is allowed")
        if not str(change["reason"]).strip():
            raise ValueError("Explain how the evidence justifies each change")
        if change["replacement"] is None:
            if position == 0:
                raise ValueError("An exclusion must identify an existing note")
            revised[position - 1] = None
            replaced.add(position)
            continue
        note = bind_note(record(change["replacement"]), primary, evidence, dimensions)
        if position:
            revised[position - 1] = note
            replaced.add(position)
        else:
            revised.append(note)
    return [note for note in revised if note is not None]


def audit_payload(primary: dict[str, object], drafts: list[dict[str, object]], support: list[dict[str, object]],
                  coverage: list[object], dimensions: list[dict[str, object]]) -> dict[str, object]:
    return {"reading_engine": "semantic", "original": source_view(primary), "support": [source_view(s) for s in support],
            "drafts": drafts, "properties": fields(dimensions), "coverage": coverage,
            "instruction": "Verify these drafts against this original. Return only justified corrections. "
            "Use position 0 for a missing substantive idea or the one-based position to replace a draft. "
            "Return a null replacement only to exclude an unsupported note and explain why. Quote the original literally. "
            "Report any remaining defects in unresolved_issues.",
            "output_schema": audit_schema(len(drafts), dimensions)}


def fits_review(reviewer: ReviewRuntime, phase: str, title: str, language: str, payload: dict[str, object]) -> bool:
    prompt = encoded({"phase": phase, "resource": title, "language": language, **payload})
    # Exact runtime counting is needed only near the limit. Even a byte tokenizer
    # with repeated schema and JSON escaping fits under this conservative shortcut.
    return len(prompt.encode()) * 6 + 4096 <= reviewer.input_budget or reviewer.count_tokens(prompt) <= reviewer.input_budget


def validate_review_capacity(reviewer: ReviewRuntime, chunks: list[dict[str, object]], dimensions: list[dict[str, object]],
                             title: str, language: str) -> None:
    for chunk in chunks:
        for segment in records(chunk.get("segments")):
            primary = {**segment, "origin_label": chunk.get("origin_label", "")}
            # Reserve space for a grounded draft and its literal quotation before extraction.
            draft = {"title": title, "body_md": segment["text"], "quotes": [segment["text"]], "properties": {}}
            if not fits_review(reviewer, "source-audit", title, language, audit_payload(primary, [draft], [], [], dimensions)):
                raise RuntimeError("The reading reviewer needs more context for the original passage, its notes and citations")


def audit_passage(worker: ContextualReader, reviewer: ReviewRuntime, primary: dict[str, object],
                  drafts: list[dict[str, object]], evidence: list[dict[str, object]],
                  plan: dict[str, object], saved: dict[str, Any],
                  citation_issues: Callable[[list[dict[str, object]], list[dict[str, object]]], list[list[str]]] | None,
                  ) -> tuple[str, dict[str, object]]:
    coverage = [row["reason"] for row in records(plan["coverage"]) if row["segment_id"] == primary["id"]]
    notes = [semantic_note(n, worker.dimensions) for n in drafts]
    support = [s for s in evidence if s["id"] != primary["id"]]
    payload = audit_payload(primary, notes, support, coverage, worker.dimensions)
    cited = {c["segment_id"] for n in drafts for c in records(n.get("citations"))}
    if not fits_review(reviewer, "source-audit", worker.title, worker.language, payload):
        support = [s for s in support if s["id"] in cited]
        payload = audit_payload(primary, notes, support, coverage, worker.dimensions)
    schema = audit_schema(len(drafts), worker.dimensions)
    evidence = [primary, *support]
    key = fingerprint([reviewer.identity, worker.title, worker.language, payload, schema])
    def validate(answer: dict[str, object]) -> None:
        checked = apply_changes(answer, drafts, primary, evidence, worker.dimensions)
        validate_reviewed_prose(checked, evidence, worker.language)
        if citation_issues and any(citation_issues(checked, worker.origins)):
            raise ValueError("Review corrections must use valid source citations")

    answer = saved.get("answer") if saved.get("key") == key else None
    if isinstance(answer, dict):
        validate(answer)
    else:
        answer = worker.ask("independent-" + key[:24], "source-audit", {**payload, "output_schema": schema},
                            validate, schema, executor=reviewer)
    return key, answer


def review_reading(engine: SemanticReader, reviewed: list[tuple[dict[str, object], dict[str, object]]],
                   global_map: str, notes_map: str) -> str:
    reviewer = engine.deps.reviewer
    assert reviewer is not None
    reader = engine.reader
    worker = replace(reader, models=[], report_progress=False)
    selected = selected_passages(reader.chunks, engine.state)
    adjacent = adjacent_originals(reader.chunks)
    if engine.state.get("independent_revision") != reviewer.identity:
        engine.state.update(independent_revision=reviewer.identity, independent_reviews={}, independent_synthesis=None)
    results = engine.state["independent_reviews"]
    findings: list[dict[str, object]] = []
    reader.phase("reviewing", 73)
    for chunk, plan in reviewed:
        notes = records(plan["notes"])
        for segment in records(chunk["segments"]):
            identifier = str(segment["id"])
            checkpoint_id = passage_key(segment)
            if checkpoint_id not in selected:
                continue
            primary = {**segment, "origin_label": chunk.get("origin_label", "")}
            drafts = [n for n in notes if n["source_segment_id"] == identifier]
            cited = {c["segment_id"] for n in drafts for c in records(n.get("citations"))}
            support = [s for s in records(plan.get("evidence_segments")) if s["id"] in cited]
            evidence = list({s["id"]: s for s in [*support, *adjacent.get(identifier, []), primary]}.values())
            saved = results.get(checkpoint_id, {})
            key, answer = audit_passage(worker, reviewer, primary, drafts, evidence, plan,
                                        saved, engine.deps.citation_issues)
            if key != saved.get("key"):
                results[checkpoint_id] = {"key": key, "answer": answer}
                engine.state["step"] += 1
                reader.models.extend(worker.models)
                worker.models.clear()
                engine.save()
            if answer["changes"]:
                checked = apply_changes(answer, drafts, primary, evidence, reader.dimensions)
                position = next((i for i, n in enumerate(notes) if n["source_segment_id"] == identifier), len(notes))
                notes = [n for n in notes if n["source_segment_id"] != identifier]
                notes[position:position] = checked
                coverage = records(plan["coverage"])
                for row in coverage:
                    if row["segment_id"] == identifier:
                        row["reason"] = answer["assessment"]
                plan["coverage"] = coverage
                plan["evidence_segments"] = list({s["id"]: s for s in [*records(plan.get("evidence_segments")), *evidence]}.values())
            findings.append({"document": primary["origin_label"], "location": primary.get("locator"),
                             "assessment": answer["assessment"], "quote": answer["evidence_quote"],
                             "corrections": answer["changes"]})
        plan["notes"] = notes
    from backend.domains.llm_wiki.review_synthesis import synthesize
    return synthesize(engine, worker, reviewer, global_map, notes_map, findings)

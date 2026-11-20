"""Selective review of original passages after the reader has checked its drafts."""
from __future__ import annotations

from collections import defaultdict
from dataclasses import replace
from collections.abc import Callable
from typing import Any, TYPE_CHECKING

from backend.domains.llm_wiki.chunking import encoded, record, records
from backend.domains.llm_wiki.contextual_reading import fingerprint
from backend.domains.llm_wiki.reading_quality import adjacent_originals, validate_boundary_coverage, validate_reviewed_prose
from backend.domains.llm_wiki.semantic_context import source_view, terms
from backend.domains.llm_wiki.semantic_contracts import (
    MAP_SCHEMA, TEXT, bind_note, fields, note_schema, obj, semantic_note, validate_schema,
)

if TYPE_CHECKING:
    from backend.domains.llm_wiki.contextual_reading import ContextualReader
    from backend.domains.llm_wiki.ingestion import ReviewRuntime
    from backend.domains.llm_wiki.semantic_reading import SemanticReader

SAMPLE_INTERVAL = 12


def sample_passages(chunks: list[dict[str, object]]) -> set[str]:
    """Sample even short chapters and spread checks through long/unsectioned text."""
    chapters: dict[tuple[str, str], list[str]] = defaultdict(list)
    for chunk in chunks:
        for segment in records(chunk.get("segments")):
            section = str(record(segment.get("locator")).get("section") or "")
            chapters[str(chunk.get("origin_id") or chunk.get("origin_label") or ""), section].append(str(segment["id"]))
    return {block[len(block) // 2] for chapter in chapters.values()
            for block in (chapter[start:start + SAMPLE_INTERVAL] for start in range(0, len(chapter), SAMPLE_INTERVAL))}


def flagged_passage(passages: list[dict[str, object]], observations: dict[str, object]) -> str:
    signals = []
    for field in ("questions", "contradictions", "warnings"):
        values = observations.get(field)
        if isinstance(values, list):
            signals.extend(value for value in values if isinstance(value, str))
    if not signals or not passages:
        return ""
    keywords = terms(" ".join(signals))
    return str(max(passages, key=lambda s: len(keywords & terms(str(s["text"]))))["id"])


def audit_schema(size: int, dimensions: list[dict[str, object]]) -> dict[str, Any]:
    change = obj({"position": {"type": "integer", "minimum": 0, "maximum": size},
                  "reason": TEXT, "replacement": note_schema(dimensions)})
    return obj({"assessment": TEXT, "evidence_quote": TEXT, "changes": {"type": "array", "items": change}})


def apply_changes(answer: dict[str, object], drafts: list[dict[str, object]], primary: dict[str, object],
                  evidence: list[dict[str, object]], dimensions: list[dict[str, object]]) -> list[dict[str, object]]:
    validate_schema(answer, audit_schema(len(drafts), dimensions))
    quote = str(answer["evidence_quote"])
    if not quote.strip() or quote not in str(primary["text"]):
        raise ValueError("The assessment must cite an exact quotation from the primary passage")
    validate_boundary_coverage(answer["assessment"])
    revised = list(drafts)
    replaced: set[int] = set()
    for change in records(answer["changes"]):
        position = int(str(change["position"]))
        if position and position in replaced:
            raise ValueError("Only one correction per existing note is allowed")
        note = bind_note(record(change["replacement"]), primary, evidence, dimensions)
        if position:
            revised[position - 1] = note
            replaced.add(position)
        else:
            revised.append(note)
    return revised


def audit_passage(worker: ContextualReader, reviewer: ReviewRuntime, primary: dict[str, object],
                 drafts: list[dict[str, object]], evidence: list[dict[str, object]],
                 plan: dict[str, object], policy: str, saved: dict[str, Any],
                 citation_issues: Callable[[list[dict[str, object]], list[dict[str, object]]], list[list[str]]] | None,
                 ) -> tuple[str, dict[str, object]]:
    payload = {"reading_engine": "semantic", "original": source_view(primary), "support": [source_view(s) for s in evidence if s["id"] != str(primary["id"])],
               "drafts": [semantic_note(n, worker.dimensions) for n in drafts], "properties": fields(worker.dimensions),
               "coverage": [row["reason"] for row in records(plan["coverage"]) if row["segment_id"] == str(primary["id"])],
               "reader_policy": policy, "instruction": "Verify these drafts against this original. Return only justified corrections. "
               "Use position 0 to add a missing substantive idea or the one-based position of a draft to replace it. "
               "Keep faithful notes. Quote the primary original literally for each change and for the assessment."}
    schema = audit_schema(len(drafts), worker.dimensions)
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
    selected = sample_passages(reader.chunks) | set(engine.state.get("flagged_passages", []))
    adjacent = adjacent_originals(reader.chunks)
    if engine.state.get("independent_revision") != reviewer.identity:
        engine.state.update(independent_revision=reviewer.identity, independent_reviews={}, independent_synthesis=None)
    results = engine.state["independent_reviews"]
    findings: list[dict[str, object]] = []
    reader.phase("reviewing", 73)
    policy = engine.deps.reader_instructions
    for chunk, plan in reviewed:
        notes = records(plan["notes"])
        for segment in records(chunk["segments"]):
            identifier = str(segment["id"])
            if identifier not in selected:
                continue
            primary = {**segment, "origin_label": chunk.get("origin_label", "")}
            drafts = [n for n in notes if n["source_segment_id"] == identifier]
            cited = {c["segment_id"] for n in drafts for c in records(n.get("citations"))}
            support = [s for s in records(plan.get("evidence_segments")) if s["id"] in cited]
            evidence = list({s["id"]: s for s in [*support, *adjacent.get(identifier, []), primary]}.values())
            saved = results.get(identifier, {})
            key, answer = audit_passage(worker, reviewer, primary, drafts, evidence, plan, policy,
                                        saved, engine.deps.citation_issues)
            if key != saved.get("key"):
                results[identifier] = {"key": key, "answer": answer}
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
                             "assessment": answer["assessment"], "quote": answer["evidence_quote"]})
        plan["notes"] = notes
    # Both full-book maps remain available. Sample geographically across the findings
    # if their combined text exceeds the reviewer's context.
    def synthesis_payload(selected_findings: list[dict[str, object]]) -> dict[str, object]:
        return {"reading_engine": "semantic", "source_map": global_map, "notes_map": notes_map, "reviewed_passages": len(findings),
                "findings": selected_findings, "output_schema": MAP_SCHEMA, "instruction":
                "Write the final synthesis in the requested language. Check the source and notes maps against the supplied "
                "original quotations and independent assessments. Preserve disagreements, attribution and caveats. "
                "Do not claim every passage received independent review."}
    subset = findings
    while len(subset) > 1 and reviewer.count_tokens(encoded(synthesis_payload(subset))) > reviewer.input_budget * 3 // 4:
        subset = subset[::2]
    payload = synthesis_payload(subset)
    key = fingerprint([reviewer.identity, reader.title, reader.language, payload])
    saved_final = engine.state.get("independent_synthesis") or {}
    if saved_final.get("key") == key:
        final = saved_final["answer"]
        validate_schema(final, MAP_SCHEMA)
        return str(final["summary"])
    final = worker.ask("independent-synthesis", "source-synthesis", payload, lambda item: validate_schema(item, MAP_SCHEMA), MAP_SCHEMA, executor=reviewer)
    engine.state["independent_synthesis"] = {"key": key, "answer": final}
    reader.models.extend(worker.models)
    engine.save()
    return str(final["summary"])

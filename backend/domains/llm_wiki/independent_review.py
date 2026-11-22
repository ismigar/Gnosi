"""Selective review of original passages after the reader has checked its drafts."""
from __future__ import annotations

from dataclasses import replace
from functools import partial
from collections.abc import Callable
from typing import Any, TYPE_CHECKING, cast

from backend.domains.llm_wiki.audit_checkpoint_provenance import audit_scope, verified_legacy_answer
from backend.domains.llm_wiki.audit_citation_repairs import AuditCitationIssue, CitationCheck, SourceAuditValidator, citation_slots
from backend.domains.llm_wiki.chunking import encoded, record, records
from backend.domains.llm_wiki.contextual_reading import ReadingCheckpointUnavailable, fingerprint
from backend.domains.llm_wiki.pdf_page_context import page_context
from backend.domains.llm_wiki.reading_batch_recovery import PassageReviewIssue, PendingPassagesRemaining
from backend.domains.llm_wiki.reading_quality import validate_boundary_coverage, validate_reviewed_prose
from backend.domains.llm_wiki.semantic_context import source_view
from backend.domains.llm_wiki.audit_groups import ReviewPassage, fill_grouped_reviews, pending_review, review_passages
from backend.domains.llm_wiki.review_selection import passage_key
from backend.domains.llm_wiki.semantic_quote_contracts import segment_source_key
from backend.domains.llm_wiki.semantic_contracts import (
    TEXT, TEXTS, bind_note, bind_note_sources, fields, note_schema, obj, semantic_note, validate_schema,
)

if TYPE_CHECKING:
    from backend.domains.llm_wiki.contextual_reading import ContextualReader
    from backend.domains.llm_wiki.ingestion import ReviewRuntime
    from backend.domains.llm_wiki.semantic_reading import SemanticReader

def audit_schema(size: int, dimensions: list[dict[str, object]], *, bound_sources: bool = False) -> dict[str, Any]:
    replacement = note_schema(dimensions)
    if bound_sources:
        replacement["properties"]["quote_segment_ids"] = TEXTS
    else:
        replacement["properties"].pop("quote_source_keys", None)  # Provenance is bound locally.
    change = obj({"position": {"type": "integer", "minimum": 0, "maximum": size},
                  "reason": TEXT, "replacement": {"anyOf": [replacement, {"type": "null"}]}})
    return obj({"assessment": TEXT, "evidence_quote": TEXT, "unresolved_issues": TEXTS, "changes": {"type": "array", "items": change}})


def bound_changes(answer: dict[str, object], primary: dict[str, object], sources: list[dict[str, object]],
                  dimensions: list[dict[str, object]]) -> list[dict[str, object]]:
    """Retain the exact original resolved in this batch across all later merges."""
    from backend.domains.llm_wiki.semantic_quote_contracts import source_key
    changes = records(answer["changes"])
    for change in changes:
        if change["replacement"] is not None:
            replacement = record(change["replacement"])
            ids = replacement.get("quote_segment_ids")
            note, originals = bind_note_sources(replacement, primary, sources, dimensions,
                                                verified_segment_ids=ids if isinstance(ids, list) else None)
            identifiers = [str(c["segment_id"]) for c in records(note["citations"])]
            change["replacement"] = {**replacement, "quote_segment_ids": identifiers,
                                     "quote_source_keys": [source_key(source_view(s)) for s in originals]}
    return changes


def restore_audit(answer: dict[str, object], primary: dict[str, object],
                  original_sources: list[dict[str, object]], dimensions: list[dict[str, object]],
                  draft_count: int) -> dict[str, object]:
    """Resolve older literal answers in the exact source set available when they were paid for."""
    validate_schema(answer, audit_schema(draft_count, dimensions, bound_sources=True))
    changes = records(answer["changes"])
    for change in changes:
        replacement = change["replacement"]
        if isinstance(replacement, dict) and "quote_source_keys" not in replacement:
            [restored] = bound_changes({"changes": [change]}, primary, original_sources, dimensions)
            change["replacement"] = restored["replacement"]
    return {**answer, "changes": changes}


def synthesis_changes(answer: dict[str, object], sources: list[dict[str, object]],
                      document_numbers: dict[str, int] | None = None) -> list[dict[str, object]]:
    """Expose corrected text and human-readable locations to the final synthesis."""
    from backend.domains.llm_wiki.semantic_quote_contracts import source_key
    locations = {(str(s["id"]), source_key(source_view(s))): {
        "document": s.get("origin_label", ""), "location": s.get("locator", {}),
        **({"document_number": document_numbers[str(s["id"])]} if document_numbers and str(s["id"]) in document_numbers else {})
    } for s in sources}
    changes = records(answer["changes"])
    for change in changes:
        if change["replacement"] is not None:
            replacement = record(change["replacement"])
            keys = replacement.pop("quote_source_keys", [])
            identifiers = replacement.pop("quote_segment_ids", [])
            if isinstance(keys, list) and isinstance(identifiers, list) and len(keys) == len(identifiers):
                change["citation_locations"] = [locations[str(identifier), str(key)] for identifier, key in zip(identifiers, keys)]
            change["replacement"] = replacement
    return changes


def apply_changes(answer: dict[str, object], drafts: list[dict[str, object]], primary: dict[str, object],
                  evidence: list[dict[str, object]], dimensions: list[dict[str, object]]) -> list[dict[str, object]]:
    validate_schema(answer, audit_schema(len(drafts), dimensions, bound_sources=True))
    if answer["unresolved_issues"]:
        raise ValueError("The independent reviewer must resolve outstanding source issues before acceptance: "
                         + "; ".join(cast(list[str], answer["unresolved_issues"])))
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
            validate_boundary_coverage(change["reason"])
            if position == 0:
                raise ValueError("An exclusion must identify an existing note")
            revised[position - 1] = None
            replaced.add(position)
            continue
        replacement = record(change["replacement"])
        identifiers = replacement.get("quote_segment_ids")
        note = bind_note(replacement, primary, evidence, dimensions,
                         verified_segment_ids=identifiers if isinstance(identifiers, list) else None)
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


def fits_review(reviewer: ReviewRuntime, phase: str, title: str, language: str, payload: dict[str, object],
                *, canonical: bool = False) -> bool:
    prompt = encoded({"phase": phase, "resource": title, "language": language, **payload})
    # Exact runtime counting is needed only near the limit. Even a byte tokenizer
    # with repeated schema and JSON escaping fits under this conservative shortcut.
    count = reviewer.count_tokens
    if phase == "source-audit" and not canonical:
        count = getattr(reviewer, "count_structured_tokens", count)
    return len(prompt.encode()) * 6 + 4096 <= reviewer.input_budget or count(prompt) <= reviewer.input_budget


def validate_review_capacity(reviewer: ReviewRuntime, chunks: list[dict[str, object]], dimensions: list[dict[str, object]],
                             title: str, language: str) -> None:
    for chunk in chunks:
        for segment in records(chunk.get("segments")):
            primary = {**segment, "origin_label": chunk.get("origin_label", "")}
            # Reserve space for a grounded draft and its literal quotation before extraction.
            draft = {"title": title, "body_md": segment["text"], "quotes": [segment["text"]], "properties": {}}
            if not fits_review(reviewer, "source-audit", title, language, audit_payload(primary, [draft], [], [], dimensions)):
                raise RuntimeError("The reading reviewer needs more context for the original passage, its notes and citations")


def original_audit(worker: ContextualReader, reviewer: ReviewRuntime, primary: dict[str, object],
                   drafts: list[dict[str, object]], evidence: list[dict[str, object]], coverage: list[object],
                   ) -> tuple[str, dict[str, object], list[dict[str, object]]]:
    notes = [semantic_note(n, worker.dimensions) for n in drafts]
    primary_key = segment_source_key(primary)
    support = [s for s in evidence if segment_source_key(s) != primary_key]
    payload = audit_payload(primary, notes, support, coverage, worker.dimensions)
    cited = {c["segment_id"] for n in drafts for c in records(n.get("citations"))}
    # Paid checkpoints use this original selection of supporting passages in their identity.
    if not fits_review(reviewer, "source-audit", worker.title, worker.language, payload, canonical=True):
        support = [s for s in support if s["id"] in cited]
        payload = audit_payload(primary, notes, support, coverage, worker.dimensions)
    key = fingerprint([reviewer.identity, worker.title, worker.language, payload, payload["output_schema"]])
    return key, payload, support


def _validate_audit(worker: ContextualReader, primary: dict[str, object], citation_issues: CitationCheck | None,
                    check_anchor: bool, answer: dict[str, object], subset: list[dict[str, object]],
                    sources: list[dict[str, object]]) -> None:
    checked = apply_changes(answer, subset, primary, sources, worker.dimensions)
    validate_reviewed_prose(checked, sources, worker.language)
    if citation_issues and check_anchor:
        anchor: dict[str, object] = {"citations": [{"segment_id": primary["id"], "quote": answer["evidence_quote"]}]}
        for errors in citation_issues([anchor], worker.origins):
            if errors:
                raise PassageReviewIssue(" ".join(errors))
    if citation_issues and any(citation_issues(checked, worker.origins)):
        raise AuditCitationIssue(lambda: citation_slots(worker, answer, primary, sources, citation_issues))

def audit_passage(worker: ContextualReader, reviewer: ReviewRuntime, primary: dict[str, object],
                  drafts: list[dict[str, object]], evidence: list[dict[str, object]],
                  plan: dict[str, object], saved: dict[str, Any],
                  citation_issues: Callable[[list[dict[str, object]], list[dict[str, object]]], list[list[str]]] | None,
                  *, lookup_only: bool = False, finding: str = "",
                  ) -> tuple[str, dict[str, object]]:
    coverage: list[object] = [row["reason"] for row in records(plan["coverage"]) if row["segment_id"] == primary["id"]]
    if finding:
        coverage.append({"independent_finding": finding, "resolution_required":
            "Recheck every issue against the supplied originals. Make all necessary corrections and explain"
            " the resolution or an evidence-based disagreement in assessment. Keep outstanding defects open."})
    key, payload, support = original_audit(worker, reviewer, primary, drafts, evidence, coverage)
    schema = record(payload["output_schema"])
    cited = {c["segment_id"] for n in drafts for c in records(n.get("citations"))}
    original_sources = [primary, *support]
    scope = audit_scope(worker, primary, drafts, evidence)
    state_key = fingerprint([key, scope.identity]) if scope else key
    context = page_context(worker.pdf_edges, original_sources, [primary, *(s for s in support if s["id"] in cited)])
    evidence = [*original_sources, *context.additions]
    validate = partial(_validate_audit, worker, primary, citation_issues, bool(finding))
    def validate_transport(answer: dict[str, object], subset: list[dict[str, object]], sources: list[dict[str, object]]) -> None:
        try:
            validate_schema(answer, audit_schema(len(subset), worker.dimensions, bound_sources=True))
            validate(answer, subset, sources)
        except AuditCitationIssue:
            raise
        except ValueError as error:
            raise PassageReviewIssue(str(error)) from error

    matches = saved.get("key") == state_key or (scope and saved.get("key") == key and (
        scope.matches_legacy(worker.resume_job_id) or verified_legacy_answer(worker, primary, drafts, original_sources, saved, key)))
    answer = saved.get("answer") if matches else None
    if isinstance(answer, dict):
        try:
            validate_transport(answer, drafts, evidence)
        except PassageReviewIssue:
            pass  # Reopen only the individual receipt whose evidence no longer passes.
        else:
            return state_key, answer
    request = context.prompt(payload, audit=True)
    fits = fits_review(reviewer, "source-audit", worker.title, worker.language, request)
    if fits and not fits_review(reviewer, "source-audit", worker.title, worker.language, request, canonical=True):
        from backend.domains.llm_wiki.review_draft_batches import AuditRanges, review_coverage
        fits = not AuditRanges(worker, reviewer, primary, key).started(scope)
        if fits and not drafts:
            # Empty groups have no saved range. A coverage operation may have committed before the phase write.
            try:
                covered = review_coverage(worker, reviewer, primary, coverage, [], key, validate_transport, scope, recover_only=True)
            except ReadingCheckpointUnavailable:
                pass
            else:
                validate(covered, drafts, evidence)
                return state_key, covered
    try:
        answer = worker.ask("independent-" + key[:24], "source-audit", payload,
                            SourceAuditValidator(lambda item: validate_transport(item, drafts, evidence), worker, evidence),
                            schema, executor=reviewer,
                            page_context=context, checkpoint_scope=scope, checkpoint_only=lookup_only or not fits,
                            recover_governed=lookup_only, restore_legacy=lambda item:
                            restore_audit(item, primary, original_sources, worker.dimensions, len(drafts)))
        answer = {**answer, "changes": bound_changes(answer, primary, evidence, worker.dimensions)}
    except ReadingCheckpointUnavailable:
        if lookup_only:
            raise
        from backend.domains.llm_wiki.review_draft_batches import audit_in_batches
        answer = audit_in_batches(worker, reviewer, primary, drafts, support, coverage, key, validate_transport, scope)
        validate(answer, drafts, evidence)
    return state_key, answer


def grouped_audit_key(worker: ContextualReader, reviewer: ReviewRuntime, case: ReviewPassage) -> str | None:
    from backend.domains.llm_wiki.review_draft_batches import AuditRanges
    key, _, _ = original_audit(worker, reviewer, case.primary, case.drafts, case.evidence, case.coverage)
    scope = audit_scope(worker, case.primary, case.drafts, case.evidence)
    # A split or already-paid individual operation must finish through its own
    # checkpoints. A read-only probe also covers a crash before the phase write.
    if worker.resume_job_id:
        if AuditRanges(worker, reviewer, case.primary, key).started(scope):
            return None
        try:
            audit_passage(worker, reviewer, case.primary, case.drafts, case.evidence, case.plan, {},
                          worker.dependencies.citation_issues, lookup_only=True)
        except ReadingCheckpointUnavailable:
            pass
        else:
            return None
    return fingerprint([key, scope.identity]) if scope else key


def _finding(worker: ContextualReader, case: ReviewPassage, answer: dict[str, object],
             document_numbers: dict[str, int]) -> dict[str, object]:
    primary, plan = case.primary, case.plan
    evidence = case.evidence
    if answer["changes"]:
        context = page_context(worker.pdf_edges, evidence, [primary, *case.support])
        evidence = [*evidence, *context.additions]
        checked = apply_changes(answer, case.drafts, primary, evidence, worker.dimensions)
        notes = records(plan["notes"])
        position = next((i for i, n in enumerate(notes) if n["source_segment_id"] == primary["id"]), len(notes))
        notes = [n for n in notes if n["source_segment_id"] != primary["id"]]
        notes[position:position] = checked
        plan["notes"] = notes
        coverage = records(plan["coverage"])
        for row in coverage:
            if row["segment_id"] == primary["id"]:
                row["reason"] = answer["assessment"]
        plan["coverage"] = coverage
        plan["evidence_segments"] = list({segment_source_key(s): s for s in [*records(plan.get("evidence_segments")), *evidence]}.values())
    return {"document": primary["origin_label"], "location": primary.get("locator"),
            "assessment": answer["assessment"], "quote": answer["evidence_quote"],
            "corrections": synthesis_changes(answer, evidence, document_numbers)}


def review_reading(engine: SemanticReader, reviewed: list[tuple[dict[str, object], dict[str, object]]],
                   global_map: str, notes_map: str) -> str:
    reviewer = engine.deps.reviewer
    assert reviewer is not None
    reader = engine.reader
    worker = replace(reader, models=[], report_progress=False)
    document_numbers = {str(s["id"]): number for number, origin in enumerate(reader.origins, start=1)
                        for s in records(origin.get("segments"))}
    if engine.state.get("independent_revision") != reviewer.identity:
        engine.state.update(independent_revision=reviewer.identity, independent_reviews={}, independent_synthesis=None, completed=False)
        engine.save()
    results = engine.state["independent_reviews"]
    pending = engine.state.setdefault("pending_audits", {})
    cases = review_passages(engine, reviewed)
    findings = []
    reader.phase("reviewing", 73)
    fill_grouped_reviews(engine, worker, reviewer, cases)
    for case in cases:
        saved = results.get(case.receipt, results.get(passage_key(case.primary), {}))
        prior = pending.get(case.occurrence, {})
        finding = prior.get("batch_finding") or saved.get("batch_finding", "")
        worker.checkpoint_owners = tuple(prior.get("review_jobs", []))
        if prior and reader.job_id and reader.job_id not in worker.checkpoint_owners:
            prior["review_jobs"] = worker.checkpoint_jobs
            engine.save()
        try:
            key, answer = audit_passage(worker, reviewer, case.primary, case.drafts, case.evidence, case.plan,
                                       saved, engine.deps.citation_issues, finding=finding)
        except PassageReviewIssue as issue:
            pending[case.occurrence] = {**prior, **pending_review(worker, case, str(issue))}
            engine.state["completed"] = False
            engine.save()
            continue
        was_pending = pending.pop(case.occurrence, None)
        if key != saved.get("key") or case.receipt not in results:
            results[case.receipt] = {"key": key, "answer": answer, **({"batch_finding": finding} if finding else {})}
            engine.state["step"] += 1
            reader.models.extend(worker.models)
            worker.models.clear()
            engine.save()
        elif was_pending:
            engine.save()
        findings.append(_finding(worker, case, answer, document_numbers))
    if count := engine.pending_count():
        raise PendingPassagesRemaining(count)
    from backend.domains.llm_wiki.review_synthesis import synthesize
    return synthesize(engine, worker, reviewer, global_map, notes_map, findings)

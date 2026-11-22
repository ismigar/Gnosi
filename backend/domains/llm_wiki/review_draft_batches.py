"""Audit multiple notes on one original within a smaller reviewer's context."""
from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from functools import cached_property
from typing import TYPE_CHECKING

from backend.domains.llm_wiki.chunking import record, records
from backend.domains.llm_wiki.audit_checkpoint_provenance import audit_scope, previous_passage
from backend.domains.llm_wiki.contextual_reading import ReadingCheckpointUnavailable, fingerprint
from backend.domains.llm_wiki.independent_review import apply_changes, audit_payload, bound_changes, fits_review, original_audit, restore_audit
from backend.domains.llm_wiki.pdf_page_context import page_context, page_edges
from backend.domains.llm_wiki.semantic_contracts import semantic_note
from backend.domains.llm_wiki.semantic_quote_contracts import segment_source_key

if TYPE_CHECKING:
    from backend.domains.llm_wiki.audit_checkpoint_provenance import HistoricalAudit
    from backend.domains.llm_wiki.ingestion import ReviewRuntime
    from backend.domains.llm_wiki.contextual_reading import CheckpointScope, ContextualReader

Validate = Callable[[dict[str, object], list[dict[str, object]], list[dict[str, object]]], None]


def validate_note_batch(validate: Validate, answer: dict[str, object], notes: list[dict[str, object]],
                        sources: list[dict[str, object]]) -> None:
    validate(answer, notes, sources)
    if any(change["position"] == 0 for change in records(answer["changes"])):
        from backend.domains.llm_wiki.reading_batch_recovery import PassageReviewIssue
        raise PassageReviewIssue("Only the full-passage coverage check may add notes")


def note_batch_sources(primary: dict[str, object], subset: list[dict[str, object]],
                       support: list[dict[str, object]]) -> list[dict[str, object]]:
    cited = {c["segment_id"] for note in subset for c in records(note.get("citations"))}
    primary_key = segment_source_key(primary)
    return [primary, *(s for s in support if s["id"] in cited and segment_source_key(s) != primary_key)]


def note_batch_request(primary: dict[str, object], subset: list[dict[str, object]], support: list[dict[str, object]],
                       coverage: list[object], dimensions: list[dict[str, object]]) -> tuple[dict[str, object], list[dict[str, object]]]:
    sources = note_batch_sources(primary, subset, support)
    payload = audit_payload(primary, [semantic_note(n, dimensions) for n in subset], sources[1:], coverage, dimensions)
    payload["instruction"] = ("Check these notes against the original. Return only corrections or exclusions "
        "at their one-based positions, each with a source-grounded reason. The separate coverage pass checks for omissions. "
        "Summarize the supported claims in your assessment and give an exact primary quotation.")
    return payload, sources


def check_note_capacity(reviewer: ReviewRuntime, primary: dict[str, object], note: dict[str, object],
                        support: list[dict[str, object]], reason: object, dimensions: list[dict[str, object]],
                        title: str, language: str) -> None:
    payload, _ = note_batch_request(primary, [note], support, [reason], dimensions)
    if not fits_review(reviewer, "source-audit", title, language, payload):
        raise ValueError("An individual reading note and its citations exceed the reviewer's context. "
                         "Preserve its qualified claims in smaller self-contained notes.")


def check_draft_capacity(reviewer: ReviewRuntime, chunks: list[dict[str, object]], plans: dict[str, object],
                         dimensions: list[dict[str, object]], title: str, language: str) -> None:
    for chunk in chunks:
        plan = record(plans.get(str(chunk["id"])))
        if not plan:
            continue
        originals = {s["id"]: {**s, "origin_label": chunk.get("origin_label", "")} for s in records(chunk.get("segments"))}
        reasons = {r["segment_id"]: r["reason"] for r in records(plan.get("coverage"))}
        for note in records(plan.get("notes")):
            identifier = note["source_segment_id"]
            check_note_capacity(reviewer, originals[identifier], note, records(plan.get("evidence_segments")),
                                reasons.get(identifier, ""), dimensions, title, language)


def note_batch_end(start: int, drafts: list[dict[str, object]], request_for: Callable[[list[dict[str, object]]],
                   tuple[dict[str, object], list[dict[str, object]]]], fits: Callable[[dict[str, object]], bool],
                   ) -> tuple[int, dict[str, object], list[dict[str, object]]]:
    end = start + 1
    payload, sources = request_for(drafts[start:end])
    if not fits(payload):
        raise RuntimeError("The reviewer needs more context for an individual note and its required sources")
    while end < len(drafts):
        larger, more_sources = request_for(drafts[start:end + 1])
        if not fits(larger):
            break
        end += 1
        payload, sources = larger, more_sources
    return end, payload, sources


def additional_review_calls(reviewer: ReviewRuntime, chunks: list[dict[str, object]], plans: dict[str, object],
                            selected: set[str], dimensions: list[dict[str, object]], title: str, language: str) -> int:
    from backend.domains.llm_wiki.review_selection import passage_key
    extra = 0
    edges = page_edges(chunks)
    def fits(payload: dict[str, object]) -> bool:
        return fits_review(reviewer, "source-audit", title, language, payload)
    for chunk in chunks:
        plan = record(plans.get(str(chunk["id"])))
        if not plan:
            continue
        for segment in records(chunk["segments"]):
            if passage_key(segment) not in selected:
                continue
            primary = {**segment, "origin_label": chunk.get("origin_label", "")}
            drafts = [n for n in records(plan.get("notes")) if n["source_segment_id"] == segment["id"]]
            coverage = [r["reason"] for r in records(plan.get("coverage")) if r["segment_id"] == segment["id"]]
            cited = {c["segment_id"] for n in drafts for c in records(n.get("citations"))}
            primary_key = segment_source_key(primary)
            support = [s for s in records(plan.get("evidence_segments"))
                       if s["id"] in cited and segment_source_key(s) != primary_key]
            originals = [primary, *support]
            payload = audit_payload(primary, [semantic_note(n, dimensions) for n in drafts], support, coverage, dimensions)
            if fits(page_context(edges, originals, originals).prompt(payload, audit=True)):
                continue
            def request_for(subset: list[dict[str, object]]) -> tuple[dict[str, object], list[dict[str, object]]]:
                candidate, sources = note_batch_request(primary, subset, support, coverage, dimensions)
                return page_context(edges, sources, sources).prompt(candidate, audit=True), sources
            start = 0
            while start < len(drafts):
                start, _, _ = note_batch_end(start, drafts, request_for, fits)
                extra += 1  # The baseline already includes the concluding coverage pass.
    return extra


@dataclass
class AuditRanges:
    """Locate paid batches even if a different draft changed the whole passage request."""
    worker: ContextualReader
    reviewer: ReviewRuntime
    primary: dict[str, object]
    parent_key: str

    @cached_property
    def passage_id(self) -> str:
        return fingerprint([self.reviewer.identity, segment_source_key(self.primary)])[:24]

    @cached_property
    def historical(self) -> tuple[str, HistoricalAudit, list[dict[str, object]]] | None:
        prior = previous_passage(self.worker, self.worker.resume_job_id, self.primary)
        if prior is None:
            return None
        key, _, support = original_audit(self.worker, self.reviewer, self.primary, prior.drafts, prior.evidence, prior.coverage)
        return key, prior, support

    def save(self, slot: str, start: int, end: int) -> None:
        if self.worker.job_id:
            self.worker.dependencies.save_checkpoint(self.worker.job_id, f"audit-range-{self.passage_id}-{start}",
                                                     {"slot": slot, "count": end - start})

    def started(self, scope: CheckpointScope | None) -> bool:
        """Prefer a previously split audit when the new single request would also fit."""
        coverage = f"audit-coverage-{self.parent_key[:24]}"
        slots = [f"audit-range-{self.passage_id}-0", f"audit-notes-{self.parent_key[:24]}-0", coverage]
        if scope:
            slots.append(coverage + "-" + scope.identity[:20])
        if any(self.worker.has_checkpoint(slot) for slot in slots):
            return True
        return bool(self.historical and self.worker.has_checkpoint(f"audit-notes-{self.historical[0][:24]}-0"))

    def candidates(self, start: int, drafts: list[dict[str, object]], request_for: Callable[[list[dict[str, object]]],
                   tuple[dict[str, object], list[dict[str, object]]]], fits: Callable[[dict[str, object]], bool],
                   ) -> Iterator[tuple[str, int]]:
        # A range is only a hint. Its request and citation owners must still validate.
        for job in self.worker.checkpoint_jobs:
            if job:
                hint = record(self.worker.dependencies.load_checkpoint(job, f"audit-range-{self.passage_id}-{start}"))
                slot, count = hint.get("slot"), hint.get("count")
                if isinstance(slot, str) and slot.startswith("audit-notes-") and type(count) is int and 0 < count <= len(drafts) - start:
                    yield slot, start + count
        slot = f"audit-notes-{self.parent_key[:24]}-{start}"
        if self.worker.has_checkpoint(slot):
            end, _, _ = note_batch_end(start, drafts, request_for, fits)
            yield slot, end
        if self.historical:
            old_key, prior, old_support = self.historical
            slot = f"audit-notes-{old_key[:24]}-{start}"
            if start < len(prior.drafts) and self.worker.has_checkpoint(slot):
                def old_request(subset: list[dict[str, object]]) -> tuple[dict[str, object], list[dict[str, object]]]:
                    return note_batch_request(self.primary, subset, old_support, prior.coverage, self.worker.dimensions)
                end, _, _ = note_batch_end(start, prior.drafts, old_request, fits)
                if end <= len(drafts):
                    yield slot, end


def audit_in_batches(worker: ContextualReader, reviewer: ReviewRuntime, primary: dict[str, object],
                    drafts: list[dict[str, object]], support: list[dict[str, object]], coverage: list[object],
                    key: str, validate: Validate, scope: CheckpointScope | None = None) -> dict[str, object]:
    def original_request(subset: list[dict[str, object]]) -> tuple[dict[str, object], list[dict[str, object]]]:
        return note_batch_request(primary, subset, support, coverage, worker.dimensions)

    def request_for(subset: list[dict[str, object]]) -> tuple[dict[str, object], list[dict[str, object]]]:
        payload, sources = original_request(subset)
        return page_context(worker.pdf_edges, sources, sources).prompt(payload, audit=True), sources

    def fits(payload: dict[str, object]) -> bool:
        return fits_review(reviewer, "source-audit", worker.title, worker.language, payload)

    changes: list[dict[str, object]] = []
    claims: list[dict[str, object]] = []
    ranges = AuditRanges(worker, reviewer, primary, key)

    def accept_batch(slot: str, start: int, end: int, *, checkpoint_only: bool = False) -> None:
        subset = drafts[start:end]
        payload, original_sources = original_request(subset)
        context = page_context(worker.pdf_edges, original_sources, original_sources)
        batch_scope = audit_scope(worker, primary, subset, original_sources, start=start)
        sources = [*original_sources, *context.additions]
        if not checkpoint_only:
            # A crash after the paid checkpoint is written must leave its range discoverable.
            ranges.save(slot, start, end)
        answer = worker.ask(slot, "source-audit", payload, lambda item: validate_note_batch(validate, item, subset, sources),
                            record(payload["output_schema"]),
                            executor=reviewer, page_context=context, checkpoint_scope=batch_scope, checkpoint_only=checkpoint_only,
                            restore_legacy=lambda item: restore_audit(item, primary, original_sources, worker.dimensions, len(subset)))
        accepted = apply_changes(answer, subset, primary, sources, worker.dimensions)
        claims.append({"assessment": answer["assessment"], "retained": [n["title"] for n in accepted]})
        changes.extend({**change, "position": int(str(change["position"])) + start} for change in bound_changes(answer, primary, sources, worker.dimensions))
        if checkpoint_only:
            ranges.save(slot, start, end)

    start = 0
    while start < len(drafts):
        seen: set[tuple[str, int]] = set()
        for slot, end in ranges.candidates(start, drafts, original_request, lambda payload:
                fits_review(reviewer, "source-audit", worker.title, worker.language, payload, canonical=True)):
            if (slot, end) in seen:
                continue
            seen.add((slot, end))
            try:
                accept_batch(slot, start, end, checkpoint_only=True)
            except ReadingCheckpointUnavailable:
                continue
            break
        else:
            end, _, _ = note_batch_end(start, drafts, request_for, fits)
            accept_batch(f"audit-notes-{ranges.passage_id}-{start}", start, end)
        start = end

    covered = review_coverage(worker, reviewer, primary, coverage, claims, key, validate, scope)
    return {**covered, "changes": [*changes, *records(covered["changes"])]}


def review_coverage(worker: ContextualReader, reviewer: ReviewRuntime, primary: dict[str, object],
                    coverage: list[object], claims: list[dict[str, object]], key: str, validate: Validate,
                    scope: CheckpointScope | None, *, recover_only: bool = False) -> dict[str, object]:
    payload = audit_payload(primary, [], [], coverage, worker.dimensions)
    payload["instruction"] = ("Check the whole original for omissions against the claims already accepted in the review. "
        "Add only missing substantive claims at position 0 with exact primary quotations. Record remaining issues.")
    context = page_context(worker.pdf_edges, [primary], [primary])
    coverage_sources = [primary, *context.additions]
    def coverage_fits(items: list[dict[str, object]]) -> bool:
        request = context.prompt({**payload, "reviewed_claims": items}, audit=True)
        return fits_review(reviewer, "source-audit", worker.title, worker.language, request)
    def audit_coverage(items: list[dict[str, object]], *, checkpoint_only: bool = False) -> dict[str, object]:
        return worker.ask(f"audit-coverage-{key[:24]}", "source-audit", {**payload, "reviewed_claims": items},
                          lambda result: validate(result, [], coverage_sources), record(payload["output_schema"]),
                          executor=reviewer, page_context=context, checkpoint_scope=scope, checkpoint_only=checkpoint_only,
                          recover_governed=recover_only,
                          restore_legacy=lambda item: restore_audit(item, primary, [primary], worker.dimensions, 0))
    if recover_only and not fits_review(reviewer, "source-audit", worker.title, worker.language,
                                       context.prompt({**payload, "reviewed_claims": claims}, audit=True), canonical=True):
        raise ReadingCheckpointUnavailable(key)
    try:
        coverage_answer = audit_coverage(claims, checkpoint_only=recover_only or not coverage_fits(claims))
    except ReadingCheckpointUnavailable:
        if recover_only:
            raise
        from backend.domains.llm_wiki.review_synthesis import reduce_for_context
        claims = reduce_for_context(worker, reviewer, claims, coverage_fits)
        coverage_answer = audit_coverage(claims)
    return {**coverage_answer, "changes": bound_changes(coverage_answer, primary, coverage_sources, worker.dimensions)}

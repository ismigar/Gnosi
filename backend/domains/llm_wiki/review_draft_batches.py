"""Audit multiple notes on one original within a smaller reviewer's context."""
from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from backend.domains.llm_wiki.chunking import record, records
from backend.domains.llm_wiki.independent_review import apply_changes, audit_payload, fits_review
from backend.domains.llm_wiki.semantic_contracts import semantic_note

if TYPE_CHECKING:
    from backend.domains.llm_wiki.ingestion import ReviewRuntime
    from backend.domains.llm_wiki.contextual_reading import ContextualReader

Validate = Callable[[dict[str, object], list[dict[str, object]], list[dict[str, object]]], None]


def note_batch_request(primary: dict[str, object], subset: list[dict[str, object]], support: list[dict[str, object]],
                       coverage: list[object], dimensions: list[dict[str, object]]) -> tuple[dict[str, object], list[dict[str, object]]]:
    cited = {c["segment_id"] for note in subset for c in records(note.get("citations"))}
    sources = [s for s in support if s["id"] in cited and s["id"] != primary["id"]]
    payload = audit_payload(primary, [semantic_note(n, dimensions) for n in subset], sources, coverage, dimensions)
    payload["instruction"] = ("Check these notes against the original. Return only corrections or exclusions "
        "at their one-based positions, each with a source-grounded reason. The separate coverage pass checks for omissions. "
        "Summarize the supported claims in your assessment and give an exact primary quotation.")
    return payload, [primary, *sources]


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
            payload, _ = note_batch_request(originals[identifier], [note], records(plan.get("evidence_segments")),
                                            [reasons.get(identifier, "")], dimensions)
            if not fits_review(reviewer, "source-audit", title, language, payload):
                raise ValueError("An individual reading note and its citations exceed the reviewer's context. "
                                 "Preserve its qualified claims in smaller self-contained notes.")


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
            support = [s for s in records(plan.get("evidence_segments")) if s["id"] != primary["id"] and s["id"] in cited]
            if fits(audit_payload(primary, [semantic_note(n, dimensions) for n in drafts], support, coverage, dimensions)):
                continue
            def request_for(subset: list[dict[str, object]]) -> tuple[dict[str, object], list[dict[str, object]]]:
                return note_batch_request(primary, subset, support, coverage, dimensions)
            start = 0
            while start < len(drafts):
                start, _, _ = note_batch_end(start, drafts, request_for, fits)
                extra += 1  # The baseline already includes the concluding coverage pass.
    return extra


def audit_in_batches(worker: ContextualReader, reviewer: ReviewRuntime, primary: dict[str, object],
                    drafts: list[dict[str, object]], support: list[dict[str, object]], coverage: list[object],
                    key: str, validate: Validate) -> dict[str, object]:
    def request_for(subset: list[dict[str, object]]) -> tuple[dict[str, object], list[dict[str, object]]]:
        return note_batch_request(primary, subset, support, coverage, worker.dimensions)

    def fits(payload: dict[str, object]) -> bool:
        return fits_review(reviewer, "source-audit", worker.title, worker.language, payload)

    changes: list[dict[str, object]] = []
    claims: list[dict[str, object]] = []
    start = 0
    while start < len(drafts):
        end, payload, sources = note_batch_end(start, drafts, request_for, fits)
        subset = drafts[start:end]
        def check_batch(answer: dict[str, object]) -> None:
            validate(answer, subset, sources)
            if any(change["position"] == 0 for change in records(answer["changes"])):
                raise ValueError("Only the full-passage coverage check may add notes")
        answer = worker.ask(f"audit-notes-{key[:24]}-{start}", "source-audit", payload, check_batch,
                            record(payload["output_schema"]), executor=reviewer)
        accepted = apply_changes(answer, subset, primary, sources, worker.dimensions)
        claims.append({"assessment": answer["assessment"], "retained": [n["title"] for n in accepted]})
        changes.extend({**change, "position": int(str(change["position"])) + start} for change in records(answer["changes"]))
        start = end

    payload = audit_payload(primary, [], [], coverage, worker.dimensions)
    payload["instruction"] = ("Check the whole original for omissions against the claims already accepted in the review. "
        "Add only missing substantive claims at position 0 with exact primary quotations. Record remaining issues.")
    def coverage_fits(items: list[dict[str, object]]) -> bool:
        return fits({**payload, "reviewed_claims": items})
    if not coverage_fits(claims):
        from backend.domains.llm_wiki.review_synthesis import reduce_for_context
        claims = reduce_for_context(worker, reviewer, claims, coverage_fits)
    payload["reviewed_claims"] = claims
    coverage_answer = worker.ask(f"audit-coverage-{key[:24]}", "source-audit", payload,
                                 lambda result: validate(result, [], [primary]), record(payload["output_schema"]), executor=reviewer)
    return {**coverage_answer, "changes": [*changes, *records(coverage_answer["changes"])]}

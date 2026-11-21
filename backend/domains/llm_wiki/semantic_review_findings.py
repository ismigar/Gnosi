"""Retain independently valid notes from the last answer to a joint review."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import replace
import re
from typing import TYPE_CHECKING, cast

from backend.domains.llm_wiki.chunking import records
from backend.domains.llm_wiki.reading_batch_recovery import PassageReviewIssue
from backend.domains.llm_wiki.review_selection import passage_occurrence
from backend.domains.llm_wiki.semantic_contracts import review_schema, validate_schema
from backend.domains.llm_wiki import semantic_review_evidence as evidence_lookup
from backend.domains.llm_wiki.semantic_quote_contracts import segment_source_key

if TYPE_CHECKING:
    from backend.domains.llm_wiki.contextual_reading import ContextualReader
    from backend.domains.llm_wiki.semantic_reading import SemanticReader
    from backend.domains.llm_wiki.semantic_review_execution import ReviewBatch, Target

Accepted = tuple[dict[str, object], list[dict[str, object]]]
_NOTE = re.compile(r"\b(?:note|nota)[ _]+([1-9]\d*)\b", re.I)


class PartialJointReview(PassageReviewIssue):
    def __init__(self, reason: str, accepted: dict[int, Accepted], pending: dict[int, str]) -> None:
        super().__init__(reason)
        self.accepted = accepted
        self.pending = pending


def notes_with_findings(answer: dict[str, object], size: int) -> dict[int, list[str]] | None:
    findings: dict[int, list[str]] = {}
    for field in ("warnings", "unresolved_issues"):
        for issue in cast(list[str], answer.get(field, [])):
            text = issue.strip()
            first = _NOTE.match(text)
            if not first or not text[first.end():].lstrip().startswith(":"):
                return None
            numbers = {int(n) for n in _NOTE.findall(text)}
            if max(numbers) > size:
                return None
            for number in numbers:
                findings.setdefault(number, []).append(issue)
    return findings


def isolate_findings(answer: dict[str, object], batch: ReviewBatch, reader: ContextualReader,
                     check: Callable[[dict[str, object], ReviewBatch, ContextualReader], None],
                     issue: PassageReviewIssue) -> PartialJointReview | None:
    size = len(batch.targets)
    if size <= 1 or answer.get("evidence_requests"):
        return None
    try:
        validate_schema(answer, batch.schema)
    except ValueError:
        return None
    findings = notes_with_findings(answer, size)
    if findings is None:
        return None  # A finding about the whole batch still requires a joint review.
    changes = records(answer["changes"])
    schema = review_schema(1, reader.dimensions, require_resolution=True, allow_requests=True)
    accepted: dict[int, Accepted] = {}
    pending: dict[int, str] = {}
    for index, target in enumerate(batch.targets):
        number = index + 1
        if number in findings:
            pending[index] = " | ".join(findings[number])
            continue
        local = [{**change, "note": 1} for change in changes if change["note"] == number]
        projected = {**answer, "changes": local, "unresolved_issues": [], "warnings": []}
        # Numeric citation choices may refer to a sibling's original. Older
        # literal-only answers must retain their narrower historical scope.
        bound = any(isinstance(replacement := c.get("replacement"), dict) and "quote_source_keys" in replacement for c in local)
        sources = batch.evidence if bound else batch.retrieved
        own = {segment_source_key(s) for s in target[4]}
        extra = list({segment_source_key(s): s for s in sources if segment_source_key(s) not in own}.values())
        individual = replace(batch, offset=batch.offset + index, entries=[batch.entries[index]],
                             targets=[target], retrieved=extra, schema=schema)
        try:
            check(projected, individual, reader)
        except PassageReviewIssue as error:
            pending[index] = str(error)
        else:
            accepted[index] = projected, extra
    return PartialJointReview(str(issue), accepted, pending) if accepted and pending else None


def defer_review(engine: SemanticReader, batch: ReviewBatch, issue: PassageReviewIssue, deferred: set[str],
                 keys: evidence_lookup.ReviewCheckpointKeys) -> None:
    state = engine.state
    pending = state.setdefault("pending_review_groups", {})
    owners = list(dict.fromkeys(job for job in
        (*batch.checkpoint_owners, engine.reader.resume_job_id, engine.reader.job_id) if job))
    def hold(key: str, offset: int, targets: list[Target], reason: str) -> None:
        pending[key] = {"passages": {passage_occurrence(engine.reader.chunks[t[0]], t[3]): t[3].get("locator") for t in targets},
                        "offset": offset, "size": len(targets), "reason": reason, "review_jobs": owners}
        deferred.add(key)

    deferred.add(batch.key)
    if isinstance(issue, PartialJointReview):
        pending.pop(batch.key, None)
        for index, reason in issue.pending.items():
            offset = batch.offset + index
            hold(keys.individual_key(offset), offset, [batch.targets[index]], reason)
        for index, (answer, sources) in issue.accepted.items():
            offset = batch.offset + index
            key = keys.individual_key(offset)
            state["reviewed_groups"][key] = answer
            state.setdefault("reviewed_ranges", {})[str(offset)] = 1
            state.setdefault("review_sources", {})[key] = evidence_lookup.references(sources)
            pending.pop(key, None)
        state["step"] += 1
    else:
        hold(batch.key, batch.offset, batch.targets, str(issue))
    state["completed"] = False
    engine.save()

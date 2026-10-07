"""Two independent reviews with one coordinator and inherited spending scope."""
from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextvars import copy_context
from dataclasses import dataclass, replace
from typing import Any, TYPE_CHECKING, cast

from backend.domains.llm_wiki.chunking import encoded, records
from backend.domains.llm_wiki.contextual_reading import ContextualReader, fingerprint
from backend.domains.llm_wiki.reading_batch_recovery import _has_answer_tokens
from backend.domains.llm_wiki.semantic_context import auxiliary_limit, groups, relevant, source_view
from backend.domains.llm_wiki.semantic_contracts import bind_review, fields, review_schema
from backend.domains.llm_wiki.reading_quality import REVIEW_QUALITY_VERSION, validate_reviewed_prose
from backend.domains.llm_wiki import semantic_review_evidence as evidence_lookup

if TYPE_CHECKING:
    from backend.domains.llm_wiki.semantic_reading import SemanticReader

REVIEW_WORKERS = 2
Target = tuple[int, int, dict[str, object], dict[str, object], list[dict[str, object]]]


@dataclass(frozen=True)
class ReviewBatch:
    offset: int
    entries: list[dict[str, object]]
    targets: list[Target]
    retrieved: list[dict[str, object]]
    payload: dict[str, object]
    schema: dict[str, Any]
    key: str

    @property
    def evidence(self) -> list[dict[str, object]]:
        # Every original offered in the shared catalog remains available when
        # a replacement cites another note's primary or supporting passage.
        return [s for _, _, _, _, sources in self.targets for s in sources] + self.retrieved

    @property
    def evidence_targets(self) -> list[tuple[dict[str, object], dict[str, object], list[dict[str, object]]]]:
        return [(n, p, [*e, *self.retrieved]) for _, _, n, p, e in self.targets]


def prepare_batch(engine: SemanticReader, entries: list[dict[str, object]], destinations: list[Target],
                  offset: int, global_map: str, notes_map: str) -> ReviewBatch:
    reader = engine.reader
    maximum = engine.state.get("review_size_limit", len(entries))
    batch = groups(entries[offset:], engine.deps.count_tokens, reader.budget // 3, maximum)[0]
    previous_size = engine.state.get("reviewed_ranges", {}).get(str(offset))
    if previous_size and fingerprint(entries[offset:offset + previous_size]) in engine.state["reviewed_groups"]:
        batch = entries[offset:offset + previous_size]
    else:
        for start, size in engine.state.get("reviewed_ranges", {}).items():
            position = int(start)
            if (offset < position < offset + len(batch)
                    and fingerprint(entries[position:position + size]) in engine.state["reviewed_groups"]):
                batch = batch[:position - offset]
    targets = destinations[offset:offset + len(batch)]
    original = evidence_lookup.originals(reader.chunks)
    present = {s["id"] for _, _, _, _, sources in targets for s in sources}
    retrieved = relevant([s for s in original if s["id"] not in present], encoded(batch), engine.deps.count_tokens,
                         auxiliary_limit(reader.budget, 10, 8000))
    payload: dict[str, object] = {
        "global_map": global_map, "all_notes_map": notes_map, "notes": batch,
        "available_originals": evidence_lookup.catalog(original, engine.deps.count_tokens, auxiliary_limit(reader.budget, 12, 6000)),
        "retrieved_originals": [source_view(s) for s in retrieved],
        "brain_notes": reader.relevant_index(encoded(batch), [target[3] for target in targets],
                                              maximum=8, limit=auxiliary_limit(reader.budget, 12, 4000)),
        "properties": fields(reader.dimensions),
        "instruction": "Reassess every prior_observation against the original evidence; retain in warnings only limitations still present and relevant to the supplied notes. Explain resolved observations in assessment. Review EVERY supplied note against its original evidence and the joint map of ALL notes. Correct false attribution, missing caveats, contradicted conclusions and unsupported links. Brain notes are current navigation candidates, never source evidence: reassess proposed connections and remove unsupported ones. Full adjacent originals are supplied as support: read them before declaring a page-ending sentence incomplete. Correct all validation_issues, undefined footnotes, leaked numeric source links and corrupt language. Return only changed notes with their one-based position; unchanged notes are retained by the application. Preserve distinct substantive ideas. You may omit a note only when the active reading policy excludes its original passage or the supplied source cannot support any substantive note (for example isolated metadata or a detached connector). Give a specific source-grounded omit_reason; never omit substantive content to avoid correcting it, and never change workflow state. Excluded passages remain covered and available as context. New quotes must be exact originals and include the note's own primary passage. In unresolved_issues list each note with a remaining defect or missing evidence that prevents a reliable interpretation; do not bury defects in warnings. Warnings describe only limitations genuinely present in the original, not unfinished corrections. An empty changes list means you found no needed correction, not that accuracy is guaranteed.",
    }
    payload["instruction"] = evidence_lookup.REVIEW_CONTEXT_INSTRUCTION + str(payload["instruction"])
    payload["instruction"] = str(payload["instruction"]) + (" Treat warnings as unresolved reading defects that block acceptance."
        " Put author attribution, qualified uncertainty and resolved observations in the notes and assessment,"
        " not in warnings. Independent external fact-checking is outside this source-reading task: faithfully"
        " attribute claims and retain their caveats. A page boundary is not missing evidence when its continuation"
        " is supplied; read it or request the complete pages before claiming that the argument is unavailable."
        " Correct every citation validation issue, including redundant isolated words selected as quotations.")
    return ReviewBatch(offset, batch, targets, retrieved, payload,
                       review_schema(len(batch), reader.dimensions, require_resolution=True, allow_requests=True), fingerprint(batch))


def validate_answer(answer: dict[str, object], batch: ReviewBatch, reader: ContextualReader) -> None:
    from backend.domains.llm_wiki.semantic_contracts import validate_schema
    validate_schema(answer, batch.schema)
    requests = records(answer.get("evidence_requests"))
    if any(not str(r["query"]).strip() and not r["pages"] for r in requests):
        raise ValueError("Evidence requests need a query or concrete pages")
    notes = bind_review(answer, batch.evidence_targets, reader.dimensions, shared_evidence=batch.evidence)
    if not requests:
        retained = [(i, n) for i, n in enumerate(notes) if "_review_omission" not in n]
        validate_reviewed_prose(notes, batch.evidence, reader.language)
        citation_check = getattr(reader.dependencies, "citation_issues", None)
        if citation_check:
            issues = [f"note_{i + 1}: {issue}" for (i, _), group in zip(
                retained, citation_check([n for _, n in retained], reader.origins), strict=True) for issue in group]
            if issues:
                raise ValueError("reading_quality_unresolved: " + encoded(issues))
        unresolved = [*cast(list[str], answer.get("unresolved_issues", [])), *cast(list[str], answer.get("warnings", []))]
        if unresolved:
            # Report semantic non-resolution INSIDE the governed validator, so
            # its existing single correction can act on the actual diagnosis.
            # The prior implementation accepted the operation, then stopped
            # outside the repair boundary without offering any correction.
            raise ValueError("reading_quality_unresolved: " + encoded(unresolved) +
                " This review is unfinished. Correct the affected notes, use a source-grounded exclusion only as allowed"
                " by the active policy, or request the particular missing originals in evidence_requests."
                " Do not merely clear this list or move unfinished corrections into warnings."
                " Keep source uncertainty and author attribution qualified in the note; do not invent a resolution."
                " Describe resolved findings in assessment. Warnings are for unresolved reading defects, not"
                " a request for independent external fact-checking of correctly attributed source claims.")


def ask_batch(reader: ContextualReader, batch: ReviewBatch) -> tuple[dict[str, object], list[str], list[dict[str, object]]]:
    # Only this isolated reader writes its unique phase checkpoint. Shared state,
    # progress, warnings and the final note order belong to the coordinator.
    worker = replace(reader, models=[], warnings=[], report_progress=False)
    seen: set[str] = set()
    for round_number in range(evidence_lookup.MAX_EVIDENCE_ROUNDS + 1):
        answer = worker.ask(f"semantic-review-{batch.key[:20]}-v{REVIEW_QUALITY_VERSION}-evidence-{round_number}", "verify",
                            {"reading_engine": "semantic", **batch.payload, "output_schema": batch.schema},
                            lambda value: validate_answer(value, batch, worker), batch.schema)
        requests = records(answer.get("evidence_requests"))
        if not requests:
            if answer["unresolved_issues"]:
                raise RuntimeError("reading_quality_unresolved: " + encoded(answer["unresolved_issues"]))
            return answer, worker.models, batch.retrieved
        identity = fingerprint(requests)
        if round_number == evidence_lookup.MAX_EVIDENCE_ROUNDS or identity in seen:
            raise RuntimeError("reading_quality_unresolved: evidence requests did not converge: " + encoded(requests))
        seen.add(identity)
        found, reports = evidence_lookup.retrieve(evidence_lookup.originals(reader.chunks), requests, batch.evidence,
                                                  reader.dependencies.count_tokens, reader.budget // 4)
        retrieved = list({str(s["id"]): s for s in [*batch.retrieved, *found]}.values())
        batch = replace(batch, retrieved=retrieved, payload={**batch.payload,
            "retrieved_originals": [source_view(s) for s in retrieved], "evidence_lookup": reports,
            "provisional_review": answer, "evidence_rounds_remaining": evidence_lookup.MAX_EVIDENCE_ROUNDS - round_number - 1})
    raise AssertionError("unreachable")


def store_result(engine: SemanticReader, batch: ReviewBatch,
                 result: tuple[dict[str, object], list[str], list[dict[str, object]]]) -> None:
    answer, models, retrieved = result
    engine.reader.models.extend(models)
    engine.state["step"] += 1
    engine.state["reviewed_groups"][batch.key] = answer
    engine.state.setdefault("reviewed_ranges", {})[str(batch.offset)] = len(batch.entries)
    engine.state.setdefault("review_sources", {})[batch.key] = evidence_lookup.references(retrieved)
    engine.save()


def recover_wave(engine: SemanticReader, failures: list[tuple[ReviewBatch, Exception]], completed: int) -> bool:
    fatal = []
    for batch, error in sorted(failures, key=lambda item: item[0].offset):
        if len(batch.entries) > 1 and _has_answer_tokens(error):
            limit = max(1, len(batch.entries) // 2)
            engine.state["review_size_limit"] = min(limit, engine.state.get("review_size_limit", limit))
        elif str(error) == "reading_budget_pending_cost" and completed:
            # An overlapping request may have held the remaining allowance.
            # Retry after it settles, with its result cached. No paid blind retry:
            # the SDK must reserve again; a wave without new progress stops.
            continue
        else:
            fatal.append(error)
    engine.save()
    if fatal:
        raise fatal[0]
    return not failures


def run_wave(engine: SemanticReader, batches: list[ReviewBatch]) -> bool:
    pending = [batch for batch in batches if batch.key not in engine.state["reviewed_groups"]]
    if not pending:
        return True
    engine.state.update(last_action={"phase": "verify"}, last_result={})
    engine.save()
    failures: list[tuple[ReviewBatch, Exception]] = []
    completed = 0
    # A fresh context per task propagates vault, authenticated scope, parent run,
    # cancellation ancestry and the same atomic per-book budget reservation.
    with ThreadPoolExecutor(max_workers=REVIEW_WORKERS, thread_name_prefix="reading-review") as pool:
        futures = {pool.submit(copy_context().run, ask_batch, engine.reader, batch): batch for batch in pending}
        for future in as_completed(futures):
            batch = futures[future]
            try:
                result = future.result()
            except Exception as error:
                failures.append((batch, error))
            else:
                store_result(engine, batch, result)
                completed += 1
    # Drain both calls and save every successful result before propagating any
    # failure. Never abandon paid work or enqueue a third review in this wave.
    return recover_wave(engine, failures, completed)


def review_batches(engine: SemanticReader, entries: list[dict[str, object]], destinations: list[Target],
                   global_map: str, notes_map: str) -> Iterator[tuple[ReviewBatch, list[dict[str, object]]]]:
    offset = 0
    while offset < len(entries):
        engine.reader.phase("reviewing", 55 + round(18 * offset / max(1, len(entries))))
        batches = []
        end = offset
        for _ in range(REVIEW_WORKERS):
            if end >= len(entries):
                break
            batch = prepare_batch(engine, entries, destinations, end, global_map, notes_map)
            batches.append(batch)
            end += len(batch.entries)
        if not run_wave(engine, batches):
            continue
        for batch in batches:
            saved_sources = engine.state.get("review_sources", {}).get(batch.key)
            if saved_sources is not None:
                batch = replace(batch, retrieved=evidence_lookup.restore(evidence_lookup.originals(engine.reader.chunks), saved_sources))
            answer = engine.state["reviewed_groups"][batch.key]
            validated = bind_review(answer, batch.evidence_targets, engine.reader.dimensions, shared_evidence=batch.evidence)
            validate_reviewed_prose([n for n in validated if "_review_omission" not in n], batch.evidence, engine.reader.language)
            if answer.get("unresolved_issues"):
                raise RuntimeError("reading_quality_unresolved: " + encoded(answer["unresolved_issues"]))
            engine.reader.warnings.extend(str(w) for w in answer["warnings"])
            yield batch, validated
        offset = end

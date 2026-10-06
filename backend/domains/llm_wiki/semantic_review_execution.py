"""Two independent reviews with one coordinator and inherited spending scope."""
from __future__ import annotations

from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextvars import copy_context
from dataclasses import dataclass, replace
from typing import Any, TYPE_CHECKING

from backend.domains.llm_wiki.chunking import encoded, records
from backend.domains.llm_wiki.contextual_reading import ContextualReader, fingerprint
from backend.domains.llm_wiki.reading_batch_recovery import _has_answer_tokens
from backend.domains.llm_wiki.semantic_context import groups, relevant, source_view
from backend.domains.llm_wiki.semantic_contracts import bind_review, fields, review_schema

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
    targets = destinations[offset:offset + len(batch)]
    original = [{**s, "origin_label": c.get("origin_label")} for c in reader.chunks for s in records(c.get("segments"))]
    retrieved = relevant(original, encoded(batch), engine.deps.count_tokens, reader.budget // 10)
    payload: dict[str, object] = {
        "global_map": global_map, "all_notes_map": notes_map, "notes": batch,
        "retrieved_originals": [source_view(s) for s in retrieved],
        "properties": fields(reader.dimensions),
        "instruction": "Review EVERY supplied note against its original evidence and the joint map of ALL notes. Correct false attribution, missing caveats, contradicted conclusions and unsupported links. Return only changed notes with their one-based position; unchanged notes are retained by the application. Preserve distinct ideas. Do not remove notes or change workflow state. New quotes must be exact originals and include the note's own primary passage. An empty changes list means you found no needed correction, not that accuracy is guaranteed.",
    }
    return ReviewBatch(offset, batch, targets, retrieved, payload, review_schema(len(batch), reader.dimensions), fingerprint(batch))


def ask_batch(reader: ContextualReader, batch: ReviewBatch) -> tuple[dict[str, object], list[str]]:
    # Only this isolated reader writes its unique phase checkpoint. Shared state,
    # progress, warnings and the final note order belong to the coordinator.
    worker = replace(reader, models=[], warnings=[], report_progress=False)
    def validate(answer: dict[str, object]) -> None:
        bind_review(answer, batch.evidence_targets, worker.dimensions, shared_evidence=batch.evidence)
    answer = worker.ask(f"semantic-review-{batch.key[:20]}", "verify",
                        {"reading_engine": "semantic", **batch.payload, "output_schema": batch.schema},
                        validate, batch.schema)
    return answer, worker.models


def store_result(engine: SemanticReader, batch: ReviewBatch, result: tuple[dict[str, object], list[str]]) -> None:
    answer, models = result
    engine.reader.models.extend(models)
    engine.state["step"] += 1
    engine.state["reviewed_groups"][batch.key] = answer
    engine.state.setdefault("reviewed_ranges", {})[str(batch.offset)] = len(batch.entries)
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
            answer = engine.state["reviewed_groups"][batch.key]
            validated = bind_review(answer, batch.evidence_targets, engine.reader.dimensions, shared_evidence=batch.evidence)
            engine.reader.warnings.extend(str(w) for w in answer["warnings"])
            yield batch, validated
        offset = end

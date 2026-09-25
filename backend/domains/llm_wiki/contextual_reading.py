"""Bounded execution of the process-source skill, with durable phase checkpoints."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from backend.domains.llm_wiki.ingestion import IngestionDependencies

from backend.domains.llm_wiki.chunking import encoded, split_segment, records
from backend.domains.llm_wiki.reading_contracts import validate_notes
from backend.domains.llm_wiki.reading_skill import MAP_CONTRACT, NOTE_CONTRACT, REQUEST_CONTRACT
from backend.domains.llm_wiki.recovery import call_with_retry


def fingerprint(value: object) -> str:
    return hashlib.sha256(encoded(value).encode()).hexdigest()


@dataclass
class ContextualReader:
    dependencies: IngestionDependencies
    chunks: list[dict[str, object]]
    origins: list[dict[str, object]]
    title: str
    language: str
    brain_index: list[dict[str, object]]
    dimensions: list[dict[str, object]]
    job_id: str = ""
    resume_job_id: str = ""
    models: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def budget(self) -> int:
        return self.dependencies.input_budget

    def phase(self, phase: str, progress: int | None = None) -> None:
        if self.job_id:
            fields: dict[str, object] = {"phase": phase}
            if progress is not None:
                fields["progress"] = progress
            self.dependencies.update_job(self.job_id, **fields)

    def ask(
        self,
        key: str,
        phase: str,
        payload: dict[str, object],
        validate: Callable[[dict[str, object]], None],
        contract: dict[str, object] | None = None,
    ) -> dict[str, object]:
        contract = contract or (MAP_CONTRACT if phase in {"overview", "synthesis"} else NOTE_CONTRACT)
        request = {
            "phase": phase,
            "resource": self.title,
            "language": self.language,
            "output_contract": contract,
            **payload,
        }
        if phase in {"extract", "review"}:
            request["alternative_output_contract"] = REQUEST_CONTRACT
            request["max_note_utf8_bytes"] = self.budget // 4
        prompt = encoded(request)
        identity = fingerprint(
            [
                self.dependencies.execution_revision,
                [origin.get("content_hash") for origin in self.origins],
                prompt,
            ]
        )
        saved = (
            self.dependencies.load_checkpoint(self.resume_job_id, key)
            if self.resume_job_id
            else None
        )
        if isinstance(saved, dict) and saved.get("identity") == identity:
            answer = saved.get("answer")
            if isinstance(answer, dict):
                validate(answer)
                self.models.append(str(saved.get("model") or ""))
                if self.job_id:
                    self.dependencies.save_checkpoint(self.job_id, key, saved)
                return answer
        display_phase = (
            "reviewing"
            if phase == "review" or key.startswith(("note-map", "all-notes"))
            else "overview"
            if phase in {"overview", "synthesis"}
            else "planning"
        )
        structured_generate = getattr(self.dependencies, "generate_structured", None)
        attempts = 1 if structured_generate else 2
        for attempt in range(attempts):
            if self.dependencies.count_tokens(prompt) > self.budget:
                raise RuntimeError("The reading phase exceeds the selected model's input budget")
            raw, model = call_with_retry(
                lambda timeout: structured_generate(prompt, validate, timeout) if structured_generate else self.dependencies.generate_text(
                    prompt, user_message=self.title, timeout=timeout
                ),
                on_wait=lambda: self.phase("retrying"),
                on_attempt=lambda: self.phase(display_phase),
            )
            try:
                cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
                answer = json.loads(cleaned)
                if not isinstance(answer, dict):
                    raise ValueError("Return a JSON object")
                validate(answer)
                self.models.append(model)
                if self.job_id:
                    self.dependencies.save_checkpoint(
                        self.job_id,
                        key,
                        {
                            "identity": identity,
                            "answer": answer,
                            "model": model,
                        },
                    )
                return answer
            except (ValueError, TypeError, KeyError) as exc:
                if attempt == attempts - 1:
                    raise RuntimeError(
                        f"The reading skill returned an invalid {phase} result: {exc}"
                    ) from exc
                # Reissue the full evidence, not a lossy summary of a bad answer.
                request["correction"] = str(exc)[:400]
                prompt = encoded(request)
        raise AssertionError("unreachable")

    def map(self, key: str, phase: str, material: object) -> str:
        limit = max(300, min(2_000, self.budget // 20))

        def validate(answer: dict[str, object]) -> None:
            summary = answer.get("summary")
            if not isinstance(summary, str) or not summary.strip():
                raise ValueError("summary must be a nonempty string")
            if self.dependencies.count_tokens(summary) > limit:
                raise ValueError(
                    f"Compress the summary to at most {limit} UTF-8 bytes, keeping evidence ids"
                )

        return str(
            self.ask(key, phase, {"material": material, "summary_max_utf8_bytes": limit}, validate)[
                "summary"
            ]
        )

    def combine(self, key: str, maps: list[str]) -> str:
        level = 0
        while len(maps) > 1:
            groups: list[list[str]] = []
            current: list[str] = []
            for item in maps:
                if (
                    current
                    and self.dependencies.count_tokens(encoded(current + [item])) > self.budget // 3
                ):
                    groups.append(current)
                    current = []
                current.append(item)
            if current:
                groups.append(current)
            if len(groups) >= len(maps):
                raise RuntimeError("The context maps cannot fit the selected model's budget")
            maps = [
                self.map(f"{key}-{level}-{i}", "synthesis", group) for i, group in enumerate(groups)
            ]
            level += 1
        return maps[0] if maps else "No proposed notes."

    def retrieve(self, requests: object) -> list[dict[str, object]]:
        if not isinstance(requests, dict):
            raise ValueError("requests must contain segment_ids and queries")
        ids = requests.get("segment_ids", [])
        queries = requests.get("queries", [])
        if not isinstance(ids, list) or not isinstance(queries, list):
            raise ValueError("segment_ids and queries must be lists")
        terms = set(re.findall(r"\w+", " ".join(map(str, queries)).casefold()))
        candidates = []
        # Index the actual bounded passages, including later parts of long segments.
        for chunk in self.chunks:
            for segment in records(chunk.get("segments")):
                words = set(re.findall(r"\w+", str(segment["text"]).casefold()))
                score = len(terms & words) + (1000 if segment["id"] in ids else 0)
                if score:
                    candidates.append((score, {**segment, "origin_label": chunk["origin_label"]}))
        candidates.sort(key=lambda item: -item[0])
        result: list[dict[str, object]] = []
        for _, segment in candidates:
            pieces = split_segment(
                segment, max(512, self.budget // 16), self.dependencies.count_tokens
            )
            # Prefer the portion matching the query rather than always its opening.
            pieces.sort(
                key=lambda item: -len(terms & set(re.findall(r"\w+", str(item["text"]).casefold())))
            )
            for piece in pieces:
                if self.dependencies.count_tokens(encoded(result + [piece])) <= self.budget // 8:
                    result.append(piece)
        if not result:
            self.warnings.append("A requested cross-reference had no matching original passage")
        return result

    def notes(
        self,
        index: int,
        phase: str,
        global_map: str,
        *,
        section_map: str,
        previous: dict[str, object] | None = None,
        notes_map: str = "",
        batch: int = 0,
    ) -> tuple[dict[str, object], dict[str, object]]:
        chunk = self.chunks[index]
        primary = records(chunk.get("segments"))
        context = records(chunk.get("context_segments"))
        if previous:
            context = [
                segment
                for segment in records(previous.get("evidence_segments"))
                if segment not in primary
            ]
        evidence: list[dict[str, object]] = list(primary) + context
        payload: dict[str, object] = {
            "chunk_id": chunk["id"],
            "global_map": global_map,
            "section_map": section_map,
            "primary_segments": primary,
            "context_only_segments": context,
            "dimensions": self.dimensions,
            "brain_index": self.relevant_index(global_map, primary),
        }
        if previous is not None:
            payload["proposed_notes"] = previous.get("notes", [])
            payload["all_notes_map"] = notes_map
            payload["review_scope"] = (
                "Review only these proposed notes; other batches are reviewed separately."
            )

        def validate(answer: dict[str, object]) -> None:
            validate_notes(answer, primary, evidence)
            if any(
                self.dependencies.count_tokens(encoded(note)) > self.budget // 4
                for note in records(answer.get("notes"))
            ):
                raise ValueError(
                    "Keep each atomic note within max_note_utf8_bytes; split distinct ideas"
                )

        for round_index in range(4):
            key = (
                f"{phase}-{index}-{round_index}"
                if phase == "extract"
                else f"{phase}-{index}-{batch}-{round_index}"
            )
            answer = self.ask(key, phase, payload, validate)
            if "requests" not in answer:
                answer["evidence_segments"] = evidence
                self.warnings.extend(
                    str(item)
                    for item in cast(list[object], answer.get("warnings") or [])
                    if isinstance(item, str)
                )
                return {**chunk, "evidence_segments": evidence}, answer
            if round_index == 3:
                raise RuntimeError(
                    "The reading skill could not resolve a cross-reference within the evidence budget"
                )
            retrieved = self.retrieve(answer["requests"])
            evidence = list(primary) + context + retrieved
            payload["retrieved_original_segments"] = retrieved
            payload["retrieval_notice"] = (
                "Results are bounded and may be incomplete. Refine the query if needed. "
                "If unresolved, report uncertainty in warnings and affected notes."
            )
        raise AssertionError("unreachable")

    def relevant_index(
        self, global_map: str, primary: list[dict[str, object]]
    ) -> list[dict[str, object]]:
        terms = set(re.findall(r"\w+", (global_map + encoded(primary)).casefold()))
        ranked = sorted(
            self.brain_index,
            key=lambda item: (
                -len(terms & set(re.findall(r"\w+", str(item.get("title", "")).casefold())))
            ),
        )
        result: list[dict[str, object]] = []
        for item in ranked:
            compact = {key: item.get(key) for key in ("id", "title", "type")}
            if self.dependencies.count_tokens(encoded(result + [compact])) > self.budget // 12:
                continue
            result.append(compact)
        return result

    def batches(self, values: list[dict[str, object]]) -> list[list[dict[str, object]]]:
        groups: list[list[dict[str, object]]] = []
        current: list[dict[str, object]] = []
        for value in values:
            if self.dependencies.count_tokens(encoded(value)) > self.budget // 4:
                raise RuntimeError(
                    "A generated note is too large for contextual review; use a model with a larger context"
                )
            if (
                current
                and self.dependencies.count_tokens(encoded(current + [value])) > self.budget // 4
            ):
                groups.append(current)
                current = []
            current.append(value)
        if current or not groups:
            groups.append(current)
        return groups

    def run(self) -> tuple[dict[str, object], list[str]]:
        if getattr(self.dependencies, "agent_directed", False):
            from backend.domains.llm_wiki.directed_reading import run_directed
            return run_directed(self)
        if not self.chunks:
            raise RuntimeError("No readable source segments were extracted")
        self.phase("overview", 10)
        maps = [self.map(f"overview-{i}", "overview", chunk) for i, chunk in enumerate(self.chunks)]
        global_map = self.combine("global-map", maps)
        plans = []
        for i in range(len(self.chunks)):
            plans.append(self.notes(i, "extract", global_map, section_map=maps[i]))
            self.phase("planning", 25 + round(25 * (i + 1) / len(self.chunks)))
            if self.job_id:
                self.dependencies.update_job(self.job_id, chunks_done=i + 1)
        self.phase("reviewing", 55)
        # Every proposed note contributes to the joint overview, including its body.
        note_maps = []
        all_notes = [note for _, plan in plans for note in records(plan.get("notes"))]
        for i, batch in enumerate(self.batches(all_notes)):
            note_maps.append(self.map(f"note-map-{i}", "synthesis", batch))
        notes_map = self.combine("all-notes", note_maps)
        reviewed = []
        for i, (_, plan) in enumerate(plans):
            for j, batch in enumerate(self.batches(records(plan.get("notes")))):
                reviewed.append(
                    self.notes(
                        i,
                        "review",
                        global_map,
                        section_map=maps[i],
                        previous={**plan, "notes": batch},
                        notes_map=notes_map,
                        batch=j,
                    )
                )
            self.phase("reviewing", 55 + round(15 * (i + 1) / len(plans)))
        notes, warnings = self.dependencies.reduce_plans(reviewed, self.origins, self.dimensions)
        self.warnings.extend(warnings)
        return {
            "summary": global_map,
            "notes": notes,
            "warnings": self.warnings,
            "coverage": list(
                {
                    (str(chunk["id"]), str(row["segment_id"])): {**row, "chunk_id": chunk["id"]}
                    for chunk, plan in reviewed
                    for row in records(plan.get("coverage"))
                }.values()
            ),
            "reviewed": True,
        }, self.models

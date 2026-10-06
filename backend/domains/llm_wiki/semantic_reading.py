"""Application-directed reading: interpret text, then verify it as a whole.

No model-selected actions, memory edits or persisted identifiers cross this
boundary. Every paid phase remains inside the governed runtime and budget.
"""
from __future__ import annotations

from copy import deepcopy
from collections.abc import Callable
from typing import Any

from backend.domains.llm_wiki.chunking import encoded, records
from backend.domains.llm_wiki.contextual_reading import ContextualReader, fingerprint
from backend.domains.llm_wiki.reading_batch_recovery import batch_limit, reduce_batch
from backend.domains.llm_wiki.reading_identity import reading_identity, identity_parts, map_identity
from backend.domains.llm_wiki.semantic_map_windows import map_windows
from backend.domains.llm_wiki.semantic_map_reduction import MapSizeLimit, map_limit, reduce_maps
from backend.domains.llm_wiki.semantic_context import chunk_view, groups, overview_groups, reading_context, source_view, state_progress
from backend.domains.llm_wiki.semantic_contracts import (
    MAP_SCHEMA, bind_interpretation, fields, interpretation_schema, validate_schema,
)

ENGINE_VERSION = 2


class SemanticReader:
    def __init__(self, reader: ContextualReader) -> None:
        self.reader = reader
        self.deps = reader.dependencies
        identity = reading_identity(self.deps.execution_revision, reader.chunks, reader.dimensions, reader.brain_index)
        self.state: dict[str, Any] = {"engine": ENGINE_VERSION, "identity": identity, "plans": {},
                                      "identity_parts": identity_parts(self.deps.execution_revision, reader.chunks, reader.dimensions, reader.brain_index),
                                      "maps": [], "observations": {}, "reviewed_groups": {}, "step": 0,
                                      "reading_context": fingerprint([reader.title, reader.language])}
        resolve_candidates = self.deps.resume_candidates
        candidates = ([reader.resume_job_id] if resolve_candidates is None else
                      resolve_candidates(reader.resume_job_id)) if reader.resume_job_id else []
        self.resume_map_jobs = candidates
        selected_resume = False
        for candidate in candidates:
            saved = self.deps.load_checkpoint(candidate, "semantic-state")
            if (isinstance(saved, dict) and saved.get("identity") == identity and saved.get("engine") == ENGINE_VERSION
                    and saved.get("reading_context") == self.state["reading_context"]
                    and (not selected_resume or state_progress(saved) > state_progress(self.state))):
                selected_resume = True
                self.state = deepcopy(saved)
                reader.resume_job_id = candidate
                if self.deps.resume_job_status:
                    reduce_batch(self.state, str(self.deps.resume_job_status(candidate).get("error") or ""))
        reader.models.extend(self.state.get("models", []))
        self.save()

    def save(self) -> None:
        self.state["models"] = list(dict.fromkeys(self.reader.models))
        if self.reader.job_id:
            self.deps.save_checkpoint(self.reader.job_id, "semantic-state", self.state)
            self.deps.update_job(self.reader.job_id, chunks_done=len(self.state["plans"]),
                                 effective_batch_size=batch_limit(self.deps.batch_size, self.state),
                                 reading_engine="semantic", reading_step=self.state["step"])

    def ask(self, key: str, phase: str, payload: dict[str, object], schema: dict[str, Any], validate: Callable[[dict[str, object]], None]) -> dict[str, object]:
        if phase != "interpret":
            self.state.update(last_action={"phase": phase}, last_result={})
            self.save()
        result = self.reader.ask(key, phase, {"reading_engine": "semantic", **payload, "output_schema": schema}, validate, schema)
        self.state["step"] += 1
        self.save()
        return result

    def summarize(self, key: str, material: object, *, bounded: bool = False, maximum: int | None = None) -> str:
        # A retry requests extra headroom; the shared map capacity remains
        # the acceptance boundary for a complete answer.
        limit = min(map_limit(self.reader.budget), maximum) if maximum is not None else map_limit(self.reader.budget)
        if getattr(self.deps, "generate_prose", None):
            return self.prose_map(key, material, limit, bounded=bounded)
        def validate(answer: dict[str, object]) -> None:
            validate_schema(answer, MAP_SCHEMA)
            if bounded and self.deps.count_tokens(str(answer["summary"])) > map_limit(self.reader.budget):
                raise MapSizeLimit(str(answer["summary"]))
            if self.deps.count_tokens(str(answer["summary"])) > max(2000, self.reader.budget // 8):
                raise ValueError("The argument map exceeds its reserved context capacity")
        answer = self.ask(key, "overview", {"material": material, "summary_max_tokens": limit,
            **({"map_contract": "bounded-reduction-v1"} if bounded else {}),
            "instruction": self.map_instruction(limit, bounded)}, MAP_SCHEMA, validate)
        return str(answer["summary"])

    @staticmethod
    def map_instruction(limit: int, bounded: bool) -> str:
        return (f"Write one concise argument map within {limit} estimated tokens. "
            f"Use at most {max(40, limit // 12)} words, since the application estimates tokens conservatively. "
            "Preserve the central claims, reasoning, attribution, disagreements, caveats, unanswered questions and the ending. "
            "Merge repetition and omit illustrative detail before omitting qualifications. Preserve document boundaries. "
            "Do not invent reference IDs; original passages remain authoritative and available for detailed interpretation. "
            + ("This is a reduction of existing maps: produce one shorter synthesis of ALL inputs, not a list of expanded summaries. "
               if bounded else "Map ALL supplied source material; bibliographic metadata alone is not an argument map. "))

    def prose_map(self, key: str, material: object, limit: int, *, bounded: bool = False) -> str:
        from backend.domains.llm_wiki.recovery import call_with_retry
        generate = self.deps.generate_prose
        assert generate is not None
        prompt = encoded({"reading_engine": "semantic", "phase": "overview", "resource": self.reader.title,
            "language": self.reader.language, "material": material, "summary_max_tokens": limit,
            **({"map_contract": "bounded-reduction-v1"} if bounded else {}),
            "instruction": "Return plain text, without JSON, an outer object or code fences. " + self.map_instruction(limit, bounded)})
        identity = map_identity(self.deps.execution_revision, self.reader.title, self.reader.language,
                               ["bounded-reduction-v1", limit, material] if bounded else material)
        def validate(text: str) -> str:
            clean = text.strip()
            if not clean or clean.startswith(("{", "```")):
                raise ValueError("Return a nonempty argument map as plain text, without JSON or code fences")
            if bounded and self.deps.count_tokens(clean) > map_limit(self.reader.budget):
                raise MapSizeLimit(clean)
            if self.deps.count_tokens(clean) > max(2000, self.reader.budget // 8):
                raise ValueError("The argument map exceeds its reserved context capacity")
            return clean
        cached = next((value for job in self.resume_map_jobs
                       if isinstance(value := self.deps.load_checkpoint(job, key), dict)
                       and value.get("identity") == identity and value.get("complete") is True), None)
        if isinstance(cached, dict):
            text, model = validate(str(cached["summary"])), str(cached["model"])
        else:
            if self.deps.count_tokens(prompt) > self.reader.budget:
                raise RuntimeError("The reading phase exceeds the selected model's input budget")
            self.state.update(last_action={"phase": "overview"}, last_result={})
            self.save()
            text, model = call_with_retry(lambda timeout: generate(prompt, validate, timeout),
                on_wait=lambda: self.reader.phase("retrying"), on_attempt=lambda: self.reader.phase("overview"),
                input_bytes=len(prompt.encode()), source_bytes=self.reader.source_bytes)
            text = validate(text)
        self.reader.models.append(model)
        if self.reader.job_id:
            self.deps.save_checkpoint(self.reader.job_id, key, {"identity": identity, "summary": text, "model": model, "complete": True})
        self.state["step"] += 1
        self.save()
        return text

    def combine(self, key: str, summaries: list[str]) -> str:
        return reduce_maps(self, key, summaries)

    def overview(self) -> str:
        self.reader.phase("overview", 10)
        batches = overview_groups(self.reader.chunks, self.deps.count_tokens, self.reader.budget)
        completed = self.state.setdefault("overview_complete", {})
        for index, material in enumerate(batches):
            if str(index) not in completed:
                completed[str(index)] = map_windows(self, f"semantic-overview-{index}", material)
                self.state["maps"] = [summary for i in range(len(batches)) for summary in completed.get(str(i), [])]
                self.save()
            self.reader.phase("overview", 10 + round(10 * (index + 1) / len(batches)))
        if (not self.state.get("global_map")
                or self.deps.count_tokens(str(self.state["global_map"])) > map_limit(self.reader.budget)):
            self.state["global_map"] = self.combine("semantic-global-map", self.state["maps"])
            self.save()
        return str(self.state["global_map"])

    def interpret(self, selected: list[dict[str, object]], global_map: str) -> dict[str, Any]:
        context = reading_context(self.reader.chunks, selected, self.state["plans"], self.deps.count_tokens, self.reader.budget)
        primary = [s for c in selected for s in records(c.get("segments"))]
        evidence = records(context.pop("evidence"))
        schema = interpretation_schema(len(primary), self.reader.dimensions)
        def validate(answer: dict[str, object]) -> None:
            bind_interpretation(answer, selected, evidence, self.reader.dimensions)
        from backend.domains.llm_wiki.semantic_context import relevant
        observations: list[dict[str, object]] = [{"text": encoded(value)} for value in self.state["observations"].values()]
        selected_memory = relevant(observations, encoded([source_view(s) for s in primary]), self.deps.count_tokens, self.reader.budget // 20)
        payload = {"global_map": global_map, "related_observations": selected_memory, "documents": [c.get("origin_label") for c in selected],
                   "primary_passages": [source_view({**s, "origin_label": c.get("origin_label")}) for c in selected for s in records(c.get("segments"))], "properties": fields(self.reader.dimensions),
                   "brain_notes": self.reader.relevant_index("", primary), **context,
                   "instruction": "Interpret each primary passage in the supplied order. Return exactly one passages entry per primary passage, with substantive atomic reading notes or a concrete omission reason. Each note needs an exact quote from its own primary passage. Context clarifies interpretation, not additional extraction. Preserve qualifications and distinct voices; connect supported ideas with [[wikilinks]]. Record themes, unresolved questions and contradictions; do not edit previous memory or choose workflow actions."}
        key = "semantic-extract-" + fingerprint([c["id"] for c in selected])[:20]
        answer = self.ask(key, "interpret", payload, schema, validate)
        plans = bind_interpretation(answer, selected, evidence, self.reader.dimensions)
        self.state["observations"][key] = {k: answer[k] for k in ("themes", "questions", "contradictions", "warnings")}
        return plans

    def extract(self, global_map: str) -> None:
        remaining = [c for c in self.reader.chunks if str(c["id"]) not in self.state["plans"]]
        while remaining:
            cap = batch_limit(self.deps.batch_size, self.state)
            views = groups([chunk_view(c) for c in remaining], self.deps.count_tokens, self.reader.budget // 5, cap)
            selected = remaining[:len(views[0])]
            self.reader.phase("planning", 20 + round(35 * len(self.state["plans"]) / len(self.reader.chunks)))
            self.state.update(last_action={"delivery": "automatic"}, last_result={"delivery": "batch", "sources": selected})
            self.save()
            try:
                plans = self.interpret(selected, global_map)
            except Exception as error:
                if not reduce_batch(self.state, error):
                    raise
                self.save()
                continue
            self.state["plans"].update(plans)
            remaining = remaining[len(selected):]
            self.save()

    def note_map(self) -> str:
        if (not self.state.get("notes_map")
                or self.deps.count_tokens(str(self.state["notes_map"])) > map_limit(self.reader.budget)):
            notes = [n for c in self.reader.chunks for n in records(self.state["plans"][str(c["id"])].get("notes"))]
            material = [{"title": n["title"], "body_md": n["body_md"]} for n in notes]
            material.extend({"title": "Reading observations", "body_md": encoded(value)} for value in self.state["observations"].values())
            summaries = [summary for i, batch in enumerate(groups(material, self.deps.count_tokens, self.reader.budget // 3))
                         for summary in map_windows(self, f"semantic-note-map-{i}", batch)]
            self.state["notes_map"] = self.combine("semantic-all-notes", summaries)
            self.save()
        return str(self.state["notes_map"])

    def review(self, global_map: str, notes_map: str) -> list[tuple[dict[str, object], dict[str, object]]]:
        from backend.domains.llm_wiki.semantic_review import review_plans
        return review_plans(self, global_map, notes_map)

    def run(self) -> tuple[dict[str, object], list[str]]:
        if not self.reader.chunks:
            raise RuntimeError("No readable source segments were extracted")
        global_map = self.overview()
        self.extract(global_map)
        reviewed = self.review(global_map, self.note_map())
        notes, warnings = self.deps.reduce_plans(reviewed, self.reader.origins, self.reader.dimensions)
        self.reader.warnings.extend(warnings)
        self.state["completed"] = True
        self.save()
        return {"summary": global_map, "notes": notes, "warnings": self.reader.warnings,
                "reviewed": True, "coverage": [{**row, "chunk_id": c["id"]} for c, p in reviewed for row in records(p["coverage"])]}, self.reader.models


def run_semantic(reader: ContextualReader) -> tuple[dict[str, object], list[str]]:
    return SemanticReader(reader).run()

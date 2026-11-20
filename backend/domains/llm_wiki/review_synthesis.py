"""Ground the final synthesis in accepted changes, including their exact quotations."""
from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from backend.domains.llm_wiki.chunking import encoded
from backend.domains.llm_wiki.contextual_reading import ContextualReader, fingerprint
from backend.domains.llm_wiki.independent_review import fits_review
from backend.domains.llm_wiki.semantic_contracts import MAP_SCHEMA, validate_schema

if TYPE_CHECKING:
    from backend.domains.llm_wiki.ingestion import ReviewRuntime
    from backend.domains.llm_wiki.semantic_reading import SemanticReader


def validate_summary(answer: dict[str, object]) -> None:
    validate_schema(answer, MAP_SCHEMA)
    if not str(answer["summary"]).strip():
        raise ValueError("Return a substantive synthesis of the source")


def reduce_for_context(worker: ContextualReader, reviewer: ReviewRuntime, material: list[dict[str, object]],
                       complete_fits: Callable[[list[dict[str, object]]], bool]) -> list[dict[str, object]]:
    maximum = max(160, min(2000, reviewer.input_budget // 12))
    def map_request(items: list[dict[str, object]]) -> dict[str, object]:
        return {"reading_engine": "semantic", "output_schema": MAP_SCHEMA, "material": items, "instruction":
                f"Synthesize ALL supplied evidence within {maximum} UTF-8 bytes. Preserve the accepted claims, "
                "corrections, attribution and qualifications for the following review."}
    def fits_items(items: list[dict[str, object]]) -> bool:
        return fits_review(reviewer, "source-synthesis", worker.title, worker.language, map_request(items))
    def compact(items: list[dict[str, object]]) -> str:
        request = map_request(items)
        def validate(answer: dict[str, object]) -> None:
            validate_summary(answer)
            if len(str(answer["summary"]).encode()) > maximum:
                raise ValueError("Compress the complete evidence within the requested synthesis size")
        answer = worker.ask("review-map-" + fingerprint(request)[:24], "source-synthesis", request, validate, MAP_SCHEMA, executor=reviewer)
        return str(answer["summary"]).strip()

    while not complete_fits(material):
        groups: list[list[dict[str, object]]] = []
        for item in material:
            if not fits_items([item]):
                raise RuntimeError("The reading reviewer needs more context for a complete synthesis finding")
            if not groups or not fits_items([*groups[-1], item]):
                groups.append([])
            groups[-1].append(item)
        summaries: list[dict[str, object]] = [{"reviewed_evidence": compact(group)} for group in groups]
        if len(summaries) >= len(material) and len(encoded(summaries)) >= len(encoded(material)):
            raise RuntimeError("The reading reviewer needs more context to combine its synthesis")
        material = summaries
    return material


def synthesize(engine: SemanticReader, worker: ContextualReader, reviewer: ReviewRuntime, global_map: str,
               notes_map: str, findings: list[dict[str, object]]) -> str:
    instruction = ("Write the final synthesis in the requested language. Apply the accepted corrections and their evidence "
                   "to the source and note maps. Preserve attribution, disagreement, qualifications and the limits of the sample.")
    base = {"reading_engine": "semantic", "output_schema": MAP_SCHEMA, "reviewed_passages": len(findings)}
    payload = {**base, "source_map": global_map, "notes_map": notes_map, "findings": findings, "instruction": instruction}
    identity = fingerprint([reviewer.identity, worker.title, worker.language, payload])
    saved = engine.state.get("independent_synthesis") or {}
    if saved.get("key") == identity:
        validate_summary(saved["answer"])
        return str(saved["answer"]["summary"]).strip()

    def fits(phase: str, value: dict[str, object]) -> bool:
        return fits_review(reviewer, phase, worker.title, worker.language, value)

    if not fits("source-synthesis", payload):
        material: list[dict[str, object]] = [{"source_map": global_map}, {"notes_map": notes_map}]
        for finding in findings:
            corrections = finding["corrections"]
            if isinstance(corrections, list) and len(corrections) > 1:
                material.extend({**finding, "corrections": [change]} for change in corrections)
            else:
                material.append(finding)
        def complete_fits(items: list[dict[str, object]]) -> bool:
            return fits("source-synthesis", {**base, "reviewed_evidence": items, "instruction": instruction})
        summaries = reduce_for_context(worker, reviewer, material, complete_fits)
        payload = {**base, "reviewed_evidence": summaries, "instruction": instruction}
    final = worker.ask("independent-synthesis", "source-synthesis", payload, validate_summary, MAP_SCHEMA, executor=reviewer)
    engine.state["independent_synthesis"] = {"key": identity, "answer": final}
    engine.reader.models.extend(worker.models)
    engine.save()
    return str(final["summary"]).strip()

"""Bounded narration-only writing, semantic review and automatic revision."""
from __future__ import annotations

from math import ceil
from typing import Any, TYPE_CHECKING

from backend.services.agent_behavior import resource
from backend.services.podcast_briefing import _object

if TYPE_CHECKING:
    from collections.abc import Callable
    from backend.services.podcast_briefing import _Briefing

TEXT_SCHEMA = _object({"narration": {"type": "string", "minLength": 1}})
ISSUE_SCHEMA = _object({"issues": {"type": "array", "maxItems": 32,
    "items": {"type": "string", "minLength": 1, "maxLength": 500}}})


def _request(context: _Briefing, phase: str, data: dict[str, Any], schema: dict[str, Any], **options: Any) -> Any:
    return context.request("podcast.coverage." + phase, data, schema).model_copy(update={"options": {
        "automatic_contract": resource("operations/podcast/automatic-contract.md"), **options}})


def _audit(context: _Briefing, data: dict[str, Any]) -> list[str]:
    request = _request(context, "audit", data, ISSUE_SCHEMA)
    result = context.stage(request, lambda r: None)
    return list(result["issues"])


def _review_theme(context: _Briefing, evidence: list[dict[str, Any]], narration: str) -> list[str]:
    batches: list[list[dict[str, Any]]] = [[]]
    for brief in evidence:
        candidate = [*batches[-1], brief]
        request = _request(context, "audit", {"briefs": candidate, "narration": narration}, ISSUE_SCHEMA)
        if batches[-1] and (len(candidate) > 32 or context.cost(request) > min(80_000, context.budget)):
            batches.append([])
        batches[-1].append(brief)
    issues = []
    for batch in batches:
        issues.extend(_audit(context, {"briefs": batch, "narration": narration}))
    return list(dict.fromkeys(issues))


def _write_theme(context: _Briefing, evidence: list[dict[str, Any]], topic: dict[str, Any],
                 index: int, count: int, words: int, feedback: list[str]) -> dict[str, Any]:
    minimum, maximum = ceil(words * .9), int(words * 1.09)
    data: dict[str, Any] = {"topic": topic["topic"], "briefs": evidence, "feedback": feedback}
    options = {"min_words": minimum, "max_words": maximum, "target_words": words,
               "episode_opening": index == 0, "episode_closing": index == count - 1}
    result = _bounded_write(context, data, options)
    return {"topic": topic["topic"], "part_ids": [b["part_id"] for b in evidence],
            "narration": result["narration"].strip()}


def _write_request(context: _Briefing, data: dict[str, Any], options: dict[str, Any]) -> Any:
    from backend.services.podcast_outline import _digest
    request = _request(context, "write", data, TEXT_SCHEMA, **options)
    limit = min(80_000, context.budget)
    if context.cost(request) > limit and "previous_draft" in data:
        data = {k: v for k, v in data.items() if k != "previous_draft"}
        request = _request(context, "write", data, TEXT_SCHEMA, **options)
    while context.cost(request) > limit:
        before = context.cost(request)
        records = _digest(context, data.get("briefs", data.get("digests", [])))
        data = {k: v for k, v in data.items() if k not in {"briefs", "digests"}}
        data["digests"] = records
        request = _request(context, "write", data, TEXT_SCHEMA, **options)
        if context.cost(request) >= before:
            raise RuntimeError("podcast_theme_context_insufficient")
    return request


def _bounded_write(context: _Briefing, data: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    minimum, maximum = options["min_words"], options["max_words"]
    previous = ""
    def checked(result: dict[str, Any]) -> None:
        nonlocal previous
        previous = result["narration"]
        actual = len(previous.split())
        if not minimum <= actual <= maximum:
            raise ValueError(f"podcast_word_budget: expected {minimum}..{maximum}; received {actual}.")
    for attempt in range(3):
        try:
            return context.stage(_write_request(context, data, options), checked)
        except ValueError as error:
            if not str(error).startswith("podcast_word_budget:") or attempt == 2:
                raise
            actual, target = len(previous.split()), options["target_words"]
            feedback = f"Server counted {actual} words. Rewrite toward {target}, strictly within {minimum}..{maximum}. "
            feedback += f"Change the word count by about {target - actual}; preserve all distinct subjects and qualifications."
            data = {**data, "feedback": [*data.get("feedback", []), feedback]}
            if actual <= maximum * 4:
                data["previous_draft"] = previous
    raise ValueError("podcast_word_budget")



def write_day(context: _Briefing, briefs: list[dict[str, Any]], outline: list[dict[str, Any]],
              progress: Callable[[str], None]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    from backend.services.podcast_outline import TARGET_WORDS
    budget = TARGET_WORDS if len({b["source_id"] for b in briefs}) >= 20 else min(TARGET_WORDS, max(160, 65 * len(briefs)))
    base, remainder = divmod(budget, len(outline))
    sections: list[dict[str, Any]] = []
    for index, topic in enumerate(outline):
        progress(f"Writing and reviewing daily briefing: {index + 1}/{len(outline)} topics")
        evidence = [b for b in briefs if b["part_id"] in set(topic["part_ids"])]
        feedback: list[str] = []
        for attempt in range(3):
            section = _write_theme(context, evidence, topic, index, len(outline), base + (index < remainder), feedback)
            issues = _review_theme(context, evidence, section["narration"])
            if not issues:
                break
            feedback = [*feedback, *issues]
        else:
            raise ValueError("podcast_semantic_review_failed")
        sections.append(section)
    # Theme audits retain full evidence; this pass sees the complete subject ledger.
    for attempt in range(3):
        issues = _audit(context, {"whole_episode": True, "sections": sections,
                                 "subjects": [t.get("subjects", [t["topic"]]) for t in outline]})
        total = sum(len(s["narration"].split()) for s in sections)
        if not issues and int(budget * .9) <= total <= int(budget * 1.09):
            return sections, outline, budget
        if attempt == 2:
            raise ValueError("podcast_episode_review_failed")
        if not issues:
            issues = ["Rewrite the episode within the overall word budget, preserving all distinct subjects."]
        revised = []
        for index, topic in enumerate(outline):
            evidence = [b for b in briefs if b["part_id"] in set(topic["part_ids"])]
            section = _write_theme(context, evidence, topic, index, len(outline), base + (index < remainder),
                [*issues, "Previous complete episode: " + "\n\n".join(s["narration"] for s in sections)])
            if _review_theme(context, evidence, section["narration"]):
                raise ValueError("podcast_semantic_review_failed")
            revised.append(section)
        sections = revised
    raise ValueError("podcast_episode_review_failed")

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


def _request(context: _Briefing, phase: str, data: dict[str, Any], schema: dict[str, Any], **options: Any) -> Any:
    return context.request("podcast.coverage." + phase, data, schema).model_copy(update={"options": {
        "automatic_contract": resource("operations/podcast/automatic-contract.md"), **options}})


def _audit(context: _Briefing, data: dict[str, Any]) -> list[str]:
    from backend.services.podcast_review import review
    return review(context, data, _request)


def _review_theme(context: _Briefing, evidence: list[dict[str, Any]], narration: str) -> list[str]:
    from backend.services.podcast_review import _schema
    batches: list[list[dict[str, Any]]] = [[]]
    for brief in evidence:
        candidate = [*batches[-1], brief]
        data = {"briefs": candidate, "narration": narration}
        request = _request(context, "audit", data, _schema(data))
        if batches[-1] and (len(candidate) > 32 or context.cost(request) > min(80_000, context.budget) - 4096):
            batches.append([])
        batches[-1].append(brief)
    issues = []
    for batch in batches:
        issues.extend(_audit(context, {"briefs": batch, "narration": narration}))
    return list(dict.fromkeys(issues))


def _write_episode(context: _Briefing, evidence: list[dict[str, Any]], outline: list[dict[str, Any]],
                   words: int, feedback: list[str]) -> dict[str, Any]:
    data: dict[str, Any] = {"topic": "Complete daily briefing", "briefs": evidence, "feedback": feedback,
        "subject_groups": [{"topic": t["topic"], "subjects": t.get("subjects", [t["topic"]])} for t in outline]}
    options = {"min_words": ceil(words * .9), "max_words": int(words * 1.09), "target_words": words,
               "episode_opening": True, "episode_closing": True}
    result = _bounded_write(context, data, options)
    return {"topic": "Complete daily briefing", "part_ids": [b["part_id"] for b in evidence],
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
    feedback: list[str] = []
    for attempt in range(3):
        progress(f"Writing and reviewing complete daily briefing: pass {attempt + 1}/3")
        section = _write_episode(context, briefs, outline, budget, feedback)
        issues = _review_theme(context, briefs, section["narration"])
        if not issues:
            issues = _audit(context, {"whole_episode": True, "sections": [section],
                                     "subjects": [t.get("subjects", [t["topic"]]) for t in outline]})
        if not issues:
            return [section], outline, budget
        feedback = [*feedback, *issues, "Previous complete episode: " + section["narration"]]
    raise ValueError("podcast_semantic_review_failed")

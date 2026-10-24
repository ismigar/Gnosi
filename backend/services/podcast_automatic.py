"""Bounded narration-only writing, semantic review and automatic revision."""
from __future__ import annotations

import hashlib
import json
from math import ceil
from typing import Any, TYPE_CHECKING

from backend.services.agent_behavior import resource
from backend.services.podcast_composition import advisory_targets, schema as composition_schema, spoken_text, word_guidance

if TYPE_CHECKING:
    from collections.abc import Callable
    from backend.services.podcast_briefing import _Briefing


def _request(context: _Briefing, phase: str, data: dict[str, Any], schema: dict[str, Any], **options: Any) -> Any:
    if phase == "write" and data.get("composition_groups"):
        options["composition_contract"] = resource("operations/podcast/composition-contract.md")
    return context.request("podcast.coverage." + phase, data, schema).model_copy(update={"options": {
        "automatic_contract": resource("operations/podcast/automatic-contract.md"), **options}})


def _audit(context: _Briefing, data: dict[str, Any]) -> list[dict[str, Any]]:
    from backend.services.podcast_review import review
    return review(context, data, _request)


def _review_theme(context: _Briefing, evidence: list[dict[str, Any]], narration: str,
                  subjects: list[list[str]]) -> list[dict[str, Any]]:
    from backend.services.podcast_review import _schema
    issues = []
    for focus in ('fidelity', 'coverage'):
        batches: list[list[dict[str, Any]]] = [[]]
        for brief in evidence:
            candidate = [*batches[-1], brief]
            data = {"briefs": candidate, "narration": narration, "review_focus": focus, "subjects": subjects}
            request = _request(context, "audit", data, _schema(data))
            if batches[-1] and (len(candidate) > 16 or context.cost(request) > min(80_000, context.budget) - 4096):
                batches.append([])
            batches[-1].append(brief)
        for batch in batches:
            issues.extend(_audit(context, {"briefs": batch, "narration": narration,
                                          "review_focus": focus, "subjects": subjects}))
    return list({json.dumps(i, sort_keys=True): i for i in issues}.values())


def _write_episode(context: _Briefing, evidence: list[dict[str, Any]], outline: list[dict[str, Any]],
                   words: int, feedback: list[dict[str, Any]], previous_draft: str = "") -> dict[str, Any]:
    data: dict[str, Any] = {"topic": "Complete daily briefing", "briefs": evidence, "feedback": feedback,
        "subject_groups": [{"topic": t["topic"], "subjects": t.get("subjects", [t["topic"]])} for t in outline]}
    if len(outline) > 1:
        targets = advisory_targets(words, {f"group:{i}": len(set(group["subjects"]))
                                          for i, group in enumerate(data["subject_groups"])}, minimum=12)
        data["composition_groups"] = [{"key": key, "topic": group["topic"], "target_words": targets[key]}
            for key, group in zip(targets, data["subject_groups"], strict=True)]
    if previous_draft:
        data["previous_draft"] = previous_draft
    options = {"min_words": ceil(words * .9), "max_words": int(words * 1.09), "target_words": words,
               "episode_opening": True, "episode_closing": True}
    result = _bounded_write(context, data, options)
    return {"topic": "Complete daily briefing", "part_ids": [b["part_id"] for b in evidence],
            "narration": result["narration"].strip()}


def _write_request(context: _Briefing, data: dict[str, Any], options: dict[str, Any]) -> Any:
    from backend.services.podcast_outline import _digest
    previous_draft = data.get("previous_draft")
    request = _request(context, "write", data, composition_schema(data), **options)
    limit = min(80_000, context.budget)
    if context.cost(request) > limit and "previous_draft" in data:
        data = {k: v for k, v in data.items() if k != "previous_draft"}
        request = _request(context, "write", data, composition_schema(data), **options)
    while context.cost(request) > limit:
        before = context.cost(request)
        records = _digest(context, data.get("briefs", data.get("digests", [])))
        data = {k: v for k, v in data.items() if k not in {"briefs", "digests"}}
        data["digests"] = records
        request = _request(context, "write", data, composition_schema(data), **options)
        if context.cost(request) >= before:
            raise RuntimeError("podcast_theme_context_insufficient")
    if previous_draft and "previous_draft" not in data:
        restored = {**data, "previous_draft": previous_draft}
        candidate = _request(context, "write", restored, composition_schema(data), **options)
        if context.cost(candidate) <= limit:
            data, request = restored, candidate
    if "length_repair" in data and "previous_draft" not in data:
        state = data["length_repair"]
        data = {**data, "length_repair": {k: v for k, v in state.items()
                if k in {"target_words", "min_words", "max_words"}}}
        data["length_repair"]["mode"] = "fresh_composition"
        request = _request(context, "write", data, composition_schema(data), **options)
    return request


def _bounded_write(context: _Briefing, data: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    minimum, maximum = options["min_words"], options["max_words"]
    previous = ""
    def checked(result: dict[str, Any]) -> None:
        nonlocal previous
        previous = spoken_text(result, data)
        actual = len(previous.split())
        if not minimum <= actual <= maximum:
            direction = "Reduce" if actual > maximum else "Expand"
            change = abs(options["target_words"] - actual)
            raise ValueError(f"podcast_word_budget: expected {minimum}..{maximum}; received {actual}. "
                             f"Target {options['target_words']}. {direction} this draft by about {change} words, "
                             "preserving every distinct subject and qualification; return the complete episode. "
                             + json.dumps(word_guidance(result, data, options["target_words"]), separators=(",", ":")))
    for attempt in range(3):
        try:
            result = context.stage(_write_request(context, data, options), checked)
            return {"narration": spoken_text(result, data)}
        except ValueError as error:
            if not str(error).startswith("podcast_word_budget:") or attempt == 2:
                raise
            actual, target = len(previous.split()), options["target_words"]
            state = {"mode": "revise_draft", "current_words": actual, "target_words": target,
                     "min_words": minimum, "max_words": maximum, "word_delta": target - actual,
                     "draft_sha256": hashlib.sha256(previous.encode()).hexdigest()}
            data = {**{k: v for k, v in data.items() if k != "previous_draft"}, "length_repair": state}
            if actual <= maximum * 4:
                data["previous_draft"] = previous
    raise ValueError("podcast_word_budget")



def write_day(context: _Briefing, briefs: list[dict[str, Any]], outline: list[dict[str, Any]],
              progress: Callable[[str], None]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    from backend.services.podcast_outline import TARGET_WORDS
    budget = TARGET_WORDS if len({b["source_id"] for b in briefs}) >= 20 else min(TARGET_WORDS, max(160, 65 * len(briefs)))
    feedback: list[dict[str, Any]] = []
    previous_draft = ""
    subjects = [t.get("subjects", [t["topic"]]) for t in outline]
    for attempt in range(3):
        progress(f"Writing and reviewing complete daily briefing: pass {attempt + 1}/3")
        section = _write_episode(context, briefs, outline, budget, feedback, previous_draft)
        issues = _review_theme(context, briefs, section["narration"], subjects)
        issues.extend(_audit(context, {"whole_episode": True, "sections": [section], "subjects": subjects}))
        if not issues:
            return [section], outline, budget
        feedback = list({json.dumps(i, sort_keys=True): i for i in issues}.values())
        previous_draft = section["narration"]
    raise ValueError("podcast_semantic_review_failed")

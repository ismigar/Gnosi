"""Global thematic deduplication and a checked word budget for a ten-minute episode."""
from __future__ import annotations

from typing import Any, TYPE_CHECKING

from backend.services.agent_behavior import resource
from backend.services.podcast_briefing import _object, _section_schema, _validate_sections

if TYPE_CHECKING:
    from collections.abc import Callable
    from backend.services.podcast_briefing import _Briefing


TARGET_WORDS = 1500
MAX_TOPICS = 12


def _request(context: _Briefing, task: str, data: dict[str, Any], schema: dict[str, Any], **options: Any) -> Any:
    request = context.request("podcast.coverage." + task, data, schema)
    return request.model_copy(update={"options": {
        "concise_contract": resource("operations/podcast/concise-contract.md"), **options,
    }})


def _partition(groups: list[dict[str, Any]], cards: list[dict[str, Any]]) -> None:
    actual = [identifier for g in groups for identifier in g["part_ids"]]
    expected = [identifier for c in cards for identifier in c["part_ids"]]
    if len(actual) != len(set(actual)) or set(actual) != set(expected):
        raise ValueError("podcast_outline_coverage_incomplete_or_duplicate")
    if any(not g["topic"].strip() for g in groups):
        raise ValueError("podcast_empty_outline_topic")


def _plan_request(context: _Briefing, cards: list[dict[str, Any]]) -> Any:
    ids = [identifier for c in cards for identifier in c["part_ids"]]
    schema = _object({"topics": {"type": "array", "minItems": 1, "maxItems": MAX_TOPICS,
        "items": _object({"topic": {"type": "string", "minLength": 1, "maxLength": 180},
                          "part_ids": {"type": "array", "minItems": 1,
                                       "items": {"type": "string", "enum": ids}}})}})
    return _request(context, "plan", {"cards": cards}, schema)


def _outline(context: _Briefing, briefs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Compact subjects, not whole prose, let distant duplicate reports meet globally.
    cards = [{"topic": b["topic"], "part_ids": [b["part_id"]]} for b in briefs]
    limit = min(80_000, context.budget)
    while context.cost(_plan_request(context, cards)) > limit:
        batches: list[list[dict[str, Any]]] = [[]]
        for card in cards:
            candidate = [*batches[-1], card]
            if batches[-1] and context.cost(_plan_request(context, candidate)) > limit:
                batches.append([])
            batches[-1].append(card)
        compressed = []
        for batch in batches:
            result = context.stage(_plan_request(context, batch), lambda r: _partition(r["topics"], batch))
            compressed.extend(result["topics"])
        if len(compressed) >= len(cards):
            raise RuntimeError("podcast_outline_context_insufficient")
        cards = compressed
    result = context.stage(_plan_request(context, cards), lambda r: _partition(r["topics"], cards))
    return list(result["topics"])


def _digest(context: _Briefing, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    digests: list[dict[str, Any]] = []
    batches: list[list[dict[str, Any]]] = [[]]
    def request_for(batch: list[dict[str, Any]]) -> Any:
        ids = [{"part_id": identifier} for b in batch for identifier in b.get("part_ids", [b.get("part_id")])]
        schema = _section_schema(ids)
        schema["properties"]["sections"]["maxItems"] = 1
        return _request(context, "digest", {"briefs": batch}, schema, max_words=160)
    for record in records:
        candidate = [*batches[-1], record]
        if batches[-1] and (len(candidate) > 8 or context.cost(request_for(candidate)) > min(40_000, context.budget)):
            batches.append([])
        batches[-1].append(record)
    for batch in batches:
        expected = [{"part_id": identifier} for b in batch for identifier in b.get("part_ids", [b.get("part_id")])]
        def checked(result: dict[str, Any]) -> None:
            _validate_sections(result, expected)
            if sum(len(s["narration"].split()) for s in result["sections"]) > 160:
                raise ValueError("podcast_digest_word_budget: rewrite within 160 words preserving distinct themes")
        result = context.stage(request_for(batch), checked)
        digests.extend({"topic": s["topic"], "part_ids": s["part_ids"], "summary": s["narration"]}
                       for s in result["sections"])
    return digests


def narrate_day(context: _Briefing, briefs: list[dict[str, Any]],
                progress: Callable[[str], None]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    progress("Grouping the complete day by topic")
    outline = _outline(context, briefs)
    # Equal thematic floors prevent duplicate-heavy feeds from crowding out minor themes.
    budget = TARGET_WORDS if len({b["source_id"] for b in briefs}) >= 20 else min(TARGET_WORDS, max(160, 65 * len(briefs)))
    base, remainder = divmod(budget, len(outline))
    sections = []
    for index, topic in enumerate(outline):
        progress(f"Writing concise daily briefing: {index + 1}/{len(outline)} topics")
        ids = set(topic["part_ids"])
        evidence = [b for b in briefs if b["part_id"] in ids]
        words = base + (index < remainder)
        minimum, maximum = int(words * .95), int(words * 1.05)
        data = {"topic": topic["topic"], "briefs": evidence}
        options = {"min_words": minimum, "max_words": maximum,
                   "episode_opening": index == 0, "episode_closing": index == len(outline) - 1}
        request = _request(context, "concise", data, _section_schema(evidence), **options)
        records = evidence
        while context.cost(request) > min(80_000, context.budget):
            before = context.cost(request)
            records = _digest(context, records)
            data = {"topic": topic["topic"], "digests": records}
            request = _request(context, "concise", data, _section_schema(evidence), **options)
            if context.cost(request) >= before:
                raise RuntimeError("podcast_theme_context_insufficient")
        def checked(result: dict[str, Any]) -> None:
            _validate_sections(result, evidence)
            actual = sum(len(s["narration"].split()) for s in result["sections"])
            if not minimum <= actual <= maximum:
                raise ValueError(f"podcast_word_budget: expected {minimum}..{maximum} spoken words; received {actual}. Rewrite concisely, merging repetitions while retaining every distinct theme.")
        result = context.stage(request, checked)
        sections.extend(result["sections"])
    total = sum(len(s["narration"].split()) for s in sections)
    if not int(budget * .88) <= total <= int(budget * 1.1):
        raise ValueError("podcast_episode_word_budget_exceeded")
    return sections, outline, budget

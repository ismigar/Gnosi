"""Global thematic deduplication and a checked word budget for a ten-minute episode."""
from __future__ import annotations

from typing import Any, TYPE_CHECKING

from backend.services.agent_behavior import resource
from backend.services.podcast_briefing import _object, _section_schema, _validate_sections

if TYPE_CHECKING:
    from collections.abc import Callable
    from backend.services.podcast_briefing import _Briefing


TARGET_WORDS = 1380
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
    # Required object keys make missing/duplicated source-list entries impossible.
    limit = min(MAX_TOPICS, len(cards))
    schema = _object({"topics": {"type": "array", "minItems": limit, "maxItems": limit,
        "items": {"type": "string", "minLength": 1, "maxLength": 180}},
        "assignments": _object({c["part_ids"][0]: {"type": "integer", "enum": list(range(limit))}
                                for c in cards})})
    return context.request("podcast.coverage.plan", {"cards": cards}, schema).model_copy(update={
        "options": {"planning_contract": resource("operations/podcast/assignment-contract.md")}})


def _planning_cards(cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Route opaque card handles; expand original evidence IDs only on the server.
    return [{"topic": card["topic"], "subjects": card.get("subjects", [card["topic"]]),
             "part_ids": [f"card:{i}"]} for i, card in enumerate(cards)]


def _route(context: _Briefing, cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    visible = _planning_cards(cards)
    def checked(value: dict[str, Any]) -> None:
        if any(not label.strip() for label in value["topics"]):
            raise ValueError("podcast_empty_outline_topic")
    result = context.stage(_plan_request(context, visible), checked)
    groups: dict[str, dict[str, Any]] = {}
    for handle, card in zip((c["part_ids"][0] for c in visible), cards, strict=True):
        label = result["topics"][result["assignments"][handle]].strip()
        group = groups.setdefault(label, {"topic": label, "part_ids": [], "subjects": []})
        group["part_ids"].extend(card["part_ids"])
        group["subjects"].extend(card.get("subjects", [card["topic"]]))
    for group in groups.values():
        group["subjects"] = list(dict.fromkeys(group["subjects"]))
    routed = list(groups.values())
    _partition(routed, cards)
    return routed


def _outline(context: _Briefing, briefs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    cards = [{"topic": b["topic"], "part_ids": [b["part_id"]]} for b in briefs]
    limit = min(40_000, context.budget)
    def fits(candidate: list[dict[str, Any]]) -> bool:
        return len(candidate) <= 48 and context.cost(_plan_request(context, _planning_cards(candidate))) <= limit
    while not fits(cards):
        batches: list[list[dict[str, Any]]] = [[]]
        for card in cards:
            if batches[-1] and not fits([*batches[-1], card]):
                batches.append([])
            batches[-1].append(card)
        compressed = []
        for batch in batches:
            compressed.extend(_route(context, batch))
        if len(compressed) >= len(cards):
            raise RuntimeError("podcast_outline_context_insufficient")
        cards = compressed
    return _route(context, cards)


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
    from backend.services.podcast_automatic import write_day
    return write_day(context, briefs, outline, progress)

"""Global thematic deduplication and a checked word budget for a ten-minute episode."""
from __future__ import annotations

from typing import Any, TYPE_CHECKING

from backend.services.agent_behavior import resource
from backend.services.podcast_briefing import _object

if TYPE_CHECKING:
    from collections.abc import Callable
    from backend.services.podcast_briefing import _Briefing


TARGET_WORDS = 1380
MAX_TOPICS = 32


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
             "summary": card.get("summary", ""), "part_ids": [f"card:{i}"]} for i, card in enumerate(cards)]


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
    cards = [{"topic": b["topic"], "summary": b["summary"], "part_ids": [b["part_id"]]} for b in briefs]
    if context.cost(_plan_request(context, _planning_cards(cards))) <= min(80_000, context.budget):
        return _route(context, cards)
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


def _digest_part_ids(records: list[dict[str, Any]]) -> list[str]:
    identifiers: list[str] = []
    for record in records:
        members = record.get("part_ids", [record.get("part_id")])
        if not isinstance(members, list) or not members:
            raise ValueError("podcast_day_coverage_incomplete_or_duplicate")
        identifiers.extend(members)
    if (not identifiers or any(not isinstance(value, str) or not value for value in identifiers)
            or len(identifiers) != len(set(identifiers))):
        raise ValueError("podcast_day_coverage_incomplete_or_duplicate")
    return identifiers


def _digest(context: _Briefing, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    _digest_part_ids(records)
    digests: list[dict[str, Any]] = []
    batches: list[list[dict[str, Any]]] = [[]]
    def request_for(batch: list[dict[str, Any]]) -> Any:
        schema = _object({key: {"type": "string", "minLength": 1} for key in ("topic", "narration")})
        return _request(context, "digest", {"briefs": batch}, schema, max_words=160,
                        digest_contract=resource("operations/podcast/digest-contract.md"))
    def checked(value: dict[str, Any]) -> None:
        if not value["topic"].strip() or not value["narration"].strip():
            raise ValueError("podcast_empty_narration")
    for record in records:
        candidate = [*batches[-1], record]
        if batches[-1] and (len(candidate) > 8 or context.cost(request_for(candidate)) > min(40_000, context.budget)):
            batches.append([])
        batches[-1].append(record)
    for batch in batches:
        request = request_for(batch)
        if context.cost(request) > min(40_000, context.budget):
            raise RuntimeError("podcast_theme_context_insufficient")
        result = context.stage(request, checked)
        # Membership belongs to the exact input batch, not to model transcription.
        # Attaching it does not approve prose: original-source audits still follow.
        digests.append({"topic": result["topic"], "part_ids": _digest_part_ids(batch),
                        "summary": result["narration"]})
    return digests


def narrate_day(context: _Briefing, briefs: list[dict[str, Any]],
                progress: Callable[[str], None]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    progress("Grouping the complete day by topic")
    outline = _outline(context, briefs)
    from backend.services.podcast_automatic import write_day
    return write_day(context, briefs, outline, progress)

"""Bounded projection of durable agent messages into provider prompts."""

from __future__ import annotations

import json
from typing import List, Sequence

from langchain_core.messages import BaseMessage, SystemMessage, ToolMessage

from backend.agent.conversation_memory import compact_history_digest

MAX_MODEL_MESSAGE_CHARS = 48_000


MAX_MODEL_MESSAGE_COUNT = 32


MAX_SINGLE_MESSAGE_CHARS = 16_000


MAX_HISTORICAL_MESSAGE_CHARS = 4_000


MessageUnit = list[BaseMessage]
ProjectedUnit = tuple[int, MessageUnit, bool]
PreparedUnit = tuple[int, MessageUnit, int, bool]


def _content_text(message: BaseMessage) -> str:
    content = message.content
    if isinstance(content, str):
        return content
    return json.dumps(content, ensure_ascii=False, default=str)


def _protocol_units(source: list[BaseMessage]) -> list[MessageUnit]:
    """Keep only complete assistant/tool protocol groups."""
    units: list[MessageUnit] = []
    index = 0
    while index < len(source):
        message = source[index]
        if isinstance(message, ToolMessage):
            index += 1
            continue
        unit = [message]
        tool_call_ids = {
            str(call.get("id") or "")
            for call in (getattr(message, "tool_calls", None) or [])
            if isinstance(call, dict)
        }
        if not tool_call_ids:
            index += 1
            units.append(unit)
            continue
        cursor = index + 1
        completed_call_ids: set[str] = set()
        while cursor < len(source):
            candidate = source[cursor]
            if not isinstance(candidate, ToolMessage):
                break
            tool_call_id = str(getattr(candidate, "tool_call_id", "") or "")
            if tool_call_id not in tool_call_ids:
                break
            unit.append(candidate)
            completed_call_ids.add(tool_call_id)
            cursor += 1
        index = cursor
        if completed_call_ids == tool_call_ids:
            units.append(unit)
    return units


def _latest_human_unit_index(units: list[MessageUnit]) -> int | None:
    indexes = [
        unit_index
        for unit_index, unit in enumerate(units)
        if any(str(getattr(message, "type", "") or "") == "human" for message in unit)
    ]
    return max(indexes) if indexes else None


def _project_units(
    units: list[MessageUnit],
    latest_human_unit: int | None,
) -> list[ProjectedUnit]:
    projected: list[ProjectedUnit] = []
    for unit_index, unit in enumerate(units):
        historical = latest_human_unit is not None and unit_index < latest_human_unit
        has_tool_protocol = any(
            isinstance(message, ToolMessage) or bool(getattr(message, "tool_calls", None) or [])
            for message in unit
        )
        if not historical or not has_tool_protocol:
            projected.append((unit_index, unit, historical))
    return projected


def _truncate_unit(unit: MessageUnit, available: int) -> MessageUnit:
    result: MessageUnit = []
    remaining = max(0, available)
    for message in unit:
        text = _content_text(message)
        kept = text[:remaining]
        result.append(message if kept == text else message.model_copy(update={"content": kept}))
        remaining -= len(kept)
    return result


def _prepare_units(projected_units: list[ProjectedUnit]) -> list[PreparedUnit]:
    prepared_units: list[PreparedUnit] = []
    for unit_index, unit, historical in projected_units:
        prepared: MessageUnit = []
        unit_chars = 0
        message_limit = MAX_HISTORICAL_MESSAGE_CHARS if historical else MAX_SINGLE_MESSAGE_CHARS
        for message in unit:
            text = _content_text(message)
            if len(text) > message_limit:
                text = text[:message_limit]
                message = message.model_copy(update={"content": text})
            unit_chars += len(text)
            prepared.append(message)
        prepared_units.append((unit_index, prepared, unit_chars, historical))
    return prepared_units


def _reserve_latest_human(
    prepared_units: list[PreparedUnit],
    latest_human_unit: int | None,
    limit: int,
) -> tuple[list[tuple[int, MessageUnit]], int]:
    if latest_human_unit is None:
        return [], limit
    latest = next(
        (item for item in prepared_units if item[0] == latest_human_unit),
        None,
    )
    if latest is None:
        return [], limit
    unit_index, prepared, unit_chars, _historical = latest
    if unit_chars > limit:
        prepared = _truncate_unit(prepared, limit)
        unit_chars = limit
    return [(unit_index, prepared)], limit - unit_chars


def _select_units(
    prepared_units: list[PreparedUnit],
    latest_human_unit: int | None,
    limit: int,
) -> list[tuple[int, MessageUnit]]:
    selected, remaining = _reserve_latest_human(
        prepared_units,
        latest_human_unit,
        limit,
    )
    for unit_index, prepared, unit_chars, historical in reversed(prepared_units):
        if unit_index == latest_human_unit:
            continue
        if unit_chars > remaining and (historical or remaining <= 0):
            continue
        if unit_chars > remaining:
            prepared = _truncate_unit(prepared, remaining)
            unit_chars = remaining
        selected.append((unit_index, prepared))
        remaining -= unit_chars
        if remaining <= 0:
            break
    return selected


def _bounded_model_messages(
    messages: Sequence[BaseMessage],
    max_chars: int = MAX_MODEL_MESSAGE_CHARS,
) -> List[BaseMessage]:
    """Project checkpoint history into a bounded, valid provider prompt.

    Historical tool calls remain available in the durable checkpoint and chat
    transcript, but their raw payloads are not useful evidence for a later turn.
    The current turn keeps complete assistant/tool protocol groups.
    """
    all_messages = list(messages)
    dropped_messages = all_messages[:-MAX_MODEL_MESSAGE_COUNT]
    units = _protocol_units(all_messages[-MAX_MODEL_MESSAGE_COUNT:])
    latest_human_unit = _latest_human_unit_index(units)
    limit = min(
        MAX_MODEL_MESSAGE_CHARS,
        max(1, int(max_chars)),
    )
    prepared_units = _prepare_units(_project_units(units, latest_human_unit))
    selected_units = _select_units(prepared_units, latest_human_unit, limit)
    projected = [
        message
        for _unit_index, unit in sorted(selected_units, key=lambda item: item[0])
        for message in unit
    ]
    if dropped_messages:
        digest = compact_history_digest(dropped_messages)
        if digest:
            projected.insert(0, SystemMessage(content=digest))
    return projected

"""Workflow update translation for the public agent event stream."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any, AsyncIterator, Dict

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from backend.agent.action_confirmations import confirmation_event
from backend.agent.model_router import usage_from_message
from backend.domains.agent.routes.chat_stream_state import AgentStreamState
from backend.domains.agent.routes.checkpoints import _acquire_turn_lock
from backend.domains.agent.routes.shared import _message_text, _tool_stream_event


def _deadline_event(
    state: AgentStreamState,
    *,
    turn_timeout_seconds: int,
) -> list[str]:
    elapsed_seconds = time.monotonic() - state.request_started_at
    soft_seconds = int((state.turn_plan.get("deadline") or {}).get("soft_seconds") or 0)
    if not soft_seconds or elapsed_seconds < soft_seconds or state.deadline_warned:
        return []
    state.deadline_warned = True
    return [
        json.dumps(
            {
                "type": "deadline",
                "trace_id": state.trace_id,
                "stage": "synthesis_reserve",
                "elapsed_ms": int(elapsed_seconds * 1000),
                "remaining_ms": max(
                    0,
                    int((turn_timeout_seconds - elapsed_seconds) * 1000),
                ),
            }
        )
        + "\n"
    ]


def _update_phase(
    state: AgentStreamState,
    *,
    node_name: str,
    update_elapsed_ms: float,
    update_usages: list[Any],
) -> str:
    if node_name in {"brain_tools", "coder_tools"}:
        phase = "tools"
    elif any(update_usages):
        phase = "model"
    else:
        phase = "routing"
    state.phase_ms[phase] += update_elapsed_ms
    return phase


def _assistant_metadata(
    message: Any,
    *,
    state: AgentStreamState,
    untrusted_context_flags: list[str],
) -> tuple[Dict[str, Any], Dict[str, Any]]:
    metadata = getattr(message, "additional_kwargs", {})
    if not isinstance(metadata, dict):
        metadata = {}
    timings = state.metrics_payload()
    metadata["gnosi_timings"] = timings
    if untrusted_context_flags:
        evidence_security = dict(metadata.get("gnosi_evidence_security") or {})
        categories = list(evidence_security.get("categories") or [])
        categories.append(
            {
                "category": "attachment_instruction_override",
                "count": min(len(untrusted_context_flags), 8),
            }
        )
        severity = evidence_security.get("severity")
        evidence_security.update(
            {
                "schema_version": 1,
                "status": "tainted",
                "severity": severity if severity in {"high", "medium"} else "medium",
                "categories": categories[:8],
                "authorization_changed": False,
            }
        )
        metadata["gnosi_evidence_security"] = evidence_security
    try:
        message.additional_kwargs = metadata
    except Exception:  # noqa: BLE001
        pass
    persisted = dict(getattr(message, "additional_kwargs", {}) or {})
    if isinstance(persisted.get("gnosi_plan"), dict):
        state.quality_plan.update(persisted["gnosi_plan"])
    if isinstance(persisted.get("gnosi_verification"), dict):
        state.quality_verification = dict(persisted["gnosi_verification"])
    return persisted, timings


def _assistant_event(
    message: Any,
    content: str,
    *,
    node_name: str,
    state: AgentStreamState,
    untrusted_context_flags: list[str],
) -> str:
    metadata, timings = _assistant_metadata(
        message,
        state=state,
        untrusted_context_flags=untrusted_context_flags,
    )
    return (
        json.dumps(
            {
                "type": "message",
                "trace_id": state.trace_id,
                "role": "ai",
                "content": content,
                "node": node_name,
                "plan": metadata.get("gnosi_plan"),
                "privacy": metadata.get("gnosi_privacy"),
                "verification": metadata.get("gnosi_verification"),
                "citations": metadata.get("gnosi_citations"),
                "freshness": metadata.get("gnosi_freshness"),
                "job": metadata.get("gnosi_job"),
                "explanation": metadata.get("gnosi_explanation"),
                "quality": metadata.get("gnosi_quality"),
                "conflicts": metadata.get("gnosi_conflicts"),
                "evidence_security": metadata.get("gnosi_evidence_security"),
                "provider_fallback": metadata.get("gnosi_provider_fallback"),
                "timings": timings,
            }
        )
        + "\n"
    )


def _message_events(
    message: Any,
    turn_usage: Any,
    *,
    node_name: str,
    state: AgentStreamState,
    tool_metadata_by_name: Dict[str, Dict[str, Any]],
    untrusted_context_flags: list[str],
) -> list[str]:  # noqa: C901 - mirrors three provider message variants
    events: list[str] = []
    if turn_usage:
        state.total_in_tok += int(turn_usage[0])
        state.total_out_tok += int(turn_usage[1])
        state.model_calls += 1

    tool_calls = getattr(message, "tool_calls", None) or []
    if tool_calls:
        for tool_call in tool_calls:
            state.tool_calls_count += 1
            tool_name = str(tool_call.get("name") or "").strip()
            if tool_name:
                state.active_tool_names.add(tool_name)
                state.used_tool_names.add(tool_name)
            events.append(
                _tool_stream_event(
                    "tool_start",
                    tool_name,
                    node_name,
                    tool_metadata_by_name.get(tool_name),
                    trace_id=state.trace_id,
                )
            )
        return events

    content = _message_text(getattr(message, "content", ""))
    if message.type == "tool":
        state.active_tool_names.discard(str(message.name or "").strip())
        pending_confirmation = confirmation_event(content)
        metadata = dict(tool_metadata_by_name.get(message.name) or {})
        metadata["awaiting_confirmation"] = bool(pending_confirmation)
        events.append(
            _tool_stream_event(
                "tool_end",
                message.name,
                node_name,
                metadata,
                trace_id=state.trace_id,
            )
        )
        if pending_confirmation:
            state.answer_count += 1
            events.append(json.dumps(pending_confirmation, ensure_ascii=False) + "\n")
    elif message.type == "ai" and content:
        state.answer_count += 1
        events.append(
            _assistant_event(
                message,
                content,
                node_name=node_name,
                state=state,
                untrusted_context_flags=untrusted_context_flags,
            )
        )
    return events


def _node_events(
    node_name: str,
    state_update: Dict[str, Any],
    *,
    state: AgentStreamState,
    previous_update_at: float,
    turn_timeout_seconds: int,
    tool_metadata_by_name: Dict[str, Dict[str, Any]],
    untrusted_context_flags: list[str],
) -> tuple[list[str], float]:
    events = _deadline_event(state, turn_timeout_seconds=turn_timeout_seconds)
    phase_event = state.phase_event(state.phase_for_node(node_name))
    if phase_event:
        events.append(phase_event)
    update_at = time.monotonic()
    update_messages = state_update.get("messages", [])
    update_usages = [usage_from_message(message) for message in update_messages]
    phase = _update_phase(
        state,
        node_name=node_name,
        update_elapsed_ms=max(0.0, (update_at - previous_update_at) * 1000),
        update_usages=update_usages,
    )
    events.append(
        json.dumps(
            {
                "type": "progress",
                "trace_id": state.trace_id,
                "node": node_name,
                "phase": phase,
                "elapsed_ms": max(
                    0,
                    int((update_at - state.request_started_at) * 1000),
                ),
                "model_calls": state.model_calls,
                "tool_calls": state.tool_calls_count,
            }
        )
        + "\n"
    )
    for message, turn_usage in zip(update_messages, update_usages):
        events.extend(
            _message_events(
                message,
                turn_usage,
                node_name=node_name,
                state=state,
                tool_metadata_by_name=tool_metadata_by_name,
                untrusted_context_flags=untrusted_context_flags,
            )
        )
    return events, update_at


async def iter_workflow_events(
    *,
    state: AgentStreamState,
    turn_timeout_seconds: int,
    untrusted_context_flags: list[str],
    turn_lock: asyncio.Lock,
    db_path: Path,
    workflow: Any,
    inputs: Dict[str, Any],
    config: Dict[str, Any],
) -> AsyncIterator[str]:
    tool_metadata_by_name = {
        item.get("name"): item
        for item in (state.llm_selection or {}).get("tools", [])
        if item.get("name")
    }
    async with _acquire_turn_lock(turn_lock):
        async with asyncio.timeout(turn_timeout_seconds):
            async with AsyncSqliteSaver.from_conn_string(str(db_path)) as saver:
                agent_app = workflow.compile(checkpointer=saver)
                previous_update_at = time.monotonic()
                async for event in agent_app.astream(
                    inputs,
                    config=config,
                    stream_mode="updates",
                ):
                    for node_name, state_update in event.items():
                        events, previous_update_at = _node_events(
                            node_name,
                            state_update,
                            state=state,
                            previous_update_at=previous_update_at,
                            turn_timeout_seconds=turn_timeout_seconds,
                            tool_metadata_by_name=tool_metadata_by_name,
                            untrusted_context_flags=untrusted_context_flags,
                        )
                        for public_event in events:
                            yield public_event

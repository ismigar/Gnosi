"""Orchestration for the public NDJSON agent event stream."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, AsyncIterator, Dict

from backend.agent.action_confirmations import bind_confirmation_context
from backend.agent.model_router import record_llm_usage
from backend.agent.semantic_interpreter import clarification_message
from backend.domains.agent.routes.chat_stream_errors import (
    finalize_agent_stream,
    stream_error_events,
)
from backend.domains.agent.routes.chat_stream_state import AgentStreamState
from backend.domains.agent.routes.chat_stream_updates import iter_workflow_events
from backend.domains.agent.routes.contracts import ChatRequest
from backend.domains.agent.routes.shared import _prepare_index_title_replacements
from backend.services.workspace_service import WorkspaceContext


def _turn_plan_event(state: AgentStreamState) -> str:
    return (
        json.dumps(
            {
                "type": "turn_plan",
                "trace_id": state.trace_id,
                "plan": {
                    key: state.turn_plan.get(key)
                    for key in (
                        "schema_version",
                        "planner_version",
                        "plan_id",
                        "mode",
                        "domains",
                        "route",
                        "execution",
                        "output_strategy",
                        "required_tool",
                        "allowed_tool_count",
                        "budgets",
                        "deadline",
                        "interpretation",
                        "capability_broker",
                        "memory",
                        "optimization",
                    )
                },
                "privacy": state.turn_plan.get("privacy") or {},
                "job": state.turn_plan.get("job") or {},
            }
        )
        + "\n"
    )


def _selection_events(
    state: AgentStreamState,
    *,
    chat_req: ChatRequest,
    untrusted_context_flags: list[str],
) -> list[str]:
    selection = state.llm_selection
    if not selection:
        return []
    selected = {
        "type": "llm_selected",
        "trace_id": state.trace_id,
        "mode": selection.get("mode") or chat_req.llm_mode,
        "provider": selection.get("provider"),
        "model": selection.get("model"),
        "strategy": selection.get("model_strategy"),
        "fallbacks": list(selection.get("fallbacks") or []),
        "provider_health": list(selection.get("provider_health") or [])[:16],
        "connector_health": list(selection.get("connector_health") or [])[:32],
    }
    runtime = {
        "type": "agent_runtime",
        "trace_id": state.trace_id,
        "assigned_skill_ids": list(selection.get("assigned_skill_ids") or []),
        "active_skill_ids": list(selection.get("active_skill_ids") or []),
        "missing_skill_ids": list(selection.get("missing_skill_ids") or []),
        "unavailable_tool_ids": list(selection.get("unavailable_tool_ids") or []),
        "catalog_revision": selection.get("catalog_revision") or "",
        "supports_tools": bool(selection.get("supports_tools", False)),
        "tool_count": int(selection.get("tool_count", 0) or 0),
        "healthy_tools": sum(
            1
            for item in (selection.get("tools") or [])
            if (item.get("health") or {}).get("status") == "healthy"
        ),
        "untrusted_context_flags": min(len(untrusted_context_flags), 8),
    }
    return [json.dumps(selected) + "\n", json.dumps(runtime) + "\n"]


async def _opening_events(
    state: AgentStreamState,
    *,
    chat_req: ChatRequest,
    untrusted_context_flags: list[str],
) -> tuple[list[str], bool]:
    events = [_turn_plan_event(state)]
    initial_phase = state.phase_event("routing")
    if initial_phase:
        events.append(initial_phase)
    interpretation = state.turn_plan.get("interpretation") or {}
    should_clarify = bool(
        interpretation.get("clarification_required")
        or (
            interpretation.get("abstain")
            and state.turn_plan.get("mode") in {"lookup", "inventory", "analysis", "action"}
        )
    )
    if should_clarify:
        content = clarification_message(
            interpretation,
            state.turn_plan.get("language", "ca"),
        )
        events.extend(
            [
                json.dumps(
                    {
                        "type": "clarification",
                        "trace_id": state.trace_id,
                        "reason": (interpretation.get("ambiguities") or ["ambiguous_request"])[0],
                    },
                    ensure_ascii=False,
                )
                + "\n",
                json.dumps(
                    {
                        "type": "message",
                        "trace_id": state.trace_id,
                        "role": "ai",
                        "content": content,
                        "node": "semantic_interpreter",
                    },
                    ensure_ascii=False,
                )
                + "\n",
                json.dumps(state.metrics_payload()) + "\n",
                json.dumps(
                    {
                        "type": "done",
                        "trace_id": state.trace_id,
                        "has_response": True,
                        "message_count": 1,
                    }
                )
                + "\n",
            ]
        )
        state.metrics_emitted = True
        return events, True

    deterministic_confirmation = await asyncio.to_thread(
        _prepare_index_title_replacements,
        chat_req.message,
    )
    if deterministic_confirmation:
        state.answer_count += 1
        events.extend(
            [
                json.dumps(deterministic_confirmation, ensure_ascii=False) + "\n",
                json.dumps(state.metrics_payload()) + "\n",
                json.dumps(
                    {
                        "type": "done",
                        "trace_id": state.trace_id,
                        "has_response": True,
                        "message_count": state.answer_count,
                    }
                )
                + "\n",
            ]
        )
        state.metrics_emitted = True
        return events, True

    events.extend(
        _selection_events(
            state,
            chat_req=chat_req,
            untrusted_context_flags=untrusted_context_flags,
        )
    )
    return events, False


async def stream_agent_events(
    *,
    request_started_at: float,
    workflow_ready_at: float,
    llm_selection: Dict[str, Any],
    turn_plan: Dict[str, Any],
    trace_id: str,
    vault_scope: str,
    workspace_context: WorkspaceContext,
    agent_id: str,
    session_id: str,
    turn_timeout_seconds: int,
    chat_req: ChatRequest,
    untrusted_context_flags: list[str],
    turn_lock: asyncio.Lock,
    db_path: Path,
    workflow: Any,
    inputs: Dict[str, Any],
    config: Dict[str, Any],
    cancel_token: str,
    turn_claimed: bool,
    chat_principal: str,
) -> AsyncIterator[str]:
    state = AgentStreamState(
        request_started_at=request_started_at,
        workflow_ready_at=workflow_ready_at,
        llm_selection=llm_selection,
        turn_plan=turn_plan,
        trace_id=trace_id,
    )
    confirmation_token = bind_confirmation_context(
        vault_scope=vault_scope,
        workspace_id=workspace_context.workspace_id,
        user_id=workspace_context.user_id,
        role=workspace_context.role,
        agent_id=agent_id,
        session_id=session_id,
    )
    try:
        opening_events, terminal = await _opening_events(
            state,
            chat_req=chat_req,
            untrusted_context_flags=untrusted_context_flags,
        )
        for event in opening_events:
            yield event
        if terminal:
            return

        async for event in iter_workflow_events(
            state=state,
            turn_timeout_seconds=turn_timeout_seconds,
            untrusted_context_flags=untrusted_context_flags,
            turn_lock=turn_lock,
            db_path=db_path,
            workflow=workflow,
            inputs=inputs,
            config=config,
        ):
            yield event
        if state.total_in_tok or state.total_out_tok:
            await asyncio.to_thread(
                record_llm_usage,
                (llm_selection or {}).get("provider"),
                (llm_selection or {}).get("model"),
                state.total_in_tok,
                state.total_out_tok,
            )
            state.usage_recorded = True
        yield json.dumps(state.metrics_payload()) + "\n"
        state.metrics_emitted = True
        yield (
            json.dumps(
                {
                    "type": "done",
                    "trace_id": trace_id,
                    "has_response": state.answer_count > 0,
                    "message_count": state.answer_count,
                }
            )
            + "\n"
        )
    except Exception as error:
        async for event in stream_error_events(
            error,
            state=state,
            vault_scope=vault_scope,
            workspace_context=workspace_context,
            agent_id=agent_id,
            session_id=session_id,
            turn_timeout_seconds=turn_timeout_seconds,
            chat_req=chat_req,
        ):
            yield event
    finally:
        await finalize_agent_stream(
            state=state,
            confirmation_token=confirmation_token,
            vault_scope=vault_scope,
            workspace_context=workspace_context,
            agent_id=agent_id,
            session_id=session_id,
            chat_req=chat_req,
            cancel_token=cancel_token,
            turn_claimed=turn_claimed,
            chat_principal=chat_principal,
        )

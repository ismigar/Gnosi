"""Failure translation and cleanup for agent event streams."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from typing import Any, AsyncIterator, Optional

from langgraph.errors import GraphRecursionError

from backend.agent.action_confirmations import reset_confirmation_context
from backend.agent.model_reliability import (
    blames_the_model,
    model_evidence,
    record_failure,
)
from backend.agent.recovery import recovery_metadata
from backend.domains.agent.responses import _response_language
from backend.domains.agent.routes.chat_error_messages import failure_message
from backend.domains.agent.routes.chat_stream_state import AgentStreamState
from backend.domains.agent.routes.checkpoints import SessionBusyError
from backend.domains.agent.routes.contracts import FAILURE_MESSAGES, ChatRequest
from backend.domains.agent.routes.shared import _agent_stream_error_code
from backend.services.agent_cancellation import release as release_agent_turn
from backend.services.agent_quality_telemetry import record_quality_signal
from backend.services.agent_replay import record_event as record_replay_event
from backend.services.turn_idempotency import finish as finish_turn
from backend.services.workspace_service import WorkspaceContext
from backend.utils.errors import safe_error_detail

log = logging.getLogger(__name__)


def _failure_reason(
    error: Exception,
    *,
    provider: Any,
    model_id: Any,
    reliability_scope: str,
) -> Optional[str]:
    if isinstance(error, (SessionBusyError, TimeoutError, GraphRecursionError)):
        return None
    return record_failure(
        provider,
        model_id,
        error,
        scope_key=reliability_scope,
    )


def _friendly_stream_error(  # noqa: C901 - stable public error taxonomy
    error: Exception,
    *,
    reason: Optional[str],
    provider: Any,
    model_id: Any,
    reliability_scope: str,
    turn_timeout_seconds: int,
    language: str = "en",
) -> str:
    code = _agent_stream_error_code(error)
    category = (
        "permission" if code and ("revoked" in code or "scope" in code or "vault_unavailable" in code)
        else "budget" if code in {"agent_budget_exceeded", "agent_turn_incomplete_limit_reached", "agent_model_context_exceeded"}
        else "output" if code in {"agent_invalid_result", "agent_empty_result"}
        else ""
    )
    if category:
        return failure_message(language, category)
    if isinstance(error, TimeoutError):
        return failure_message(language, "turn_timeout", seconds=turn_timeout_seconds)
    if isinstance(error, GraphRecursionError):
        return failure_message(language, "loop")
    if reason and reason in FAILURE_MESSAGES:
        message = failure_message(language, reason)
        if blames_the_model(reason):
            evidence = model_evidence(provider, model_id, scope_key=reliability_scope)
            repeats = (evidence or {}).get("reasons", {}).get(reason, 0)
            if repeats > 1:
                message += " " + failure_message(language, "repeats", repeats=repeats)
        return message
    if isinstance(error, SessionBusyError):
        return failure_message(language, "busy")
    detail = safe_error_detail(error, context="POST /api/agent/chat event_generator")
    reference = re.search(r"\[([a-f0-9]{8})\]", detail)
    return failure_message(language, "unexpected", reference=reference[1] if reference else "—")



async def stream_error_events(
    error: Exception,
    *,
    state: AgentStreamState,
    vault_scope: str,
    workspace_context: WorkspaceContext,
    agent_id: str,
    session_id: str,
    turn_timeout_seconds: int,
    chat_req: ChatRequest,
) -> AsyncIterator[str]:
    state.stream_failed = True
    log.exception(
        "Agent event generator failed (trace_id=%s; %s; active_tools=%s): %s",
        state.trace_id,
        type(error).__name__,
        sorted(state.active_tool_names),
        str(error) or "no exception message",
    )
    provider = (state.llm_selection or {}).get("provider")
    model_id = (state.llm_selection or {}).get("model")
    reliability_scope = ":".join(
        (vault_scope, workspace_context.workspace_id, workspace_context.user_id)
    )
    reason = _failure_reason(
        error,
        provider=provider,
        model_id=model_id,
        reliability_scope=reliability_scope,
    )
    local_error_code = _agent_stream_error_code(error)
    response_language = _response_language(chat_req.message)
    friendly_error = _friendly_stream_error(
        error,
        reason=reason,
        provider=provider,
        model_id=model_id,
        reliability_scope=reliability_scope,
        turn_timeout_seconds=turn_timeout_seconds,
        language=response_language,
    )
    stable_error_code = (
        local_error_code or str(reason or "").strip() or type(error).__name__.lower()
    )[:160]
    await asyncio.to_thread(
        record_replay_event,
        state.trace_id,
        "error",
        {
            "status": "error",
            "error_code": stable_error_code,
            "duration_ms": state.metrics_payload()["total_ms"],
        },
    )
    try:
        await asyncio.to_thread(
            record_quality_signal,
            {
                "vault_scope": vault_scope,
                "workspace_id": workspace_context.workspace_id,
                "user_id": workspace_context.user_id,
            },
            agent_id=agent_id,
            session_id=session_id,
            turn_id=chat_req.turn_id or uuid.uuid4().hex,
            signal="error",
            error_code=stable_error_code,
            language=str(state.quality_plan.get("language") or "en"),
            mode=str(state.quality_plan.get("mode") or "analysis"),
            domains=state.quality_plan.get("domains") or [],
            route=str(state.quality_plan.get("route") or "General"),
            execution=str(state.quality_plan.get("execution") or "foreground"),
            output_strategy=str(state.quality_plan.get("output_strategy") or "model_synthesis"),
            required_tool=str(state.quality_plan.get("required_tool") or ""),
            verification_status=str(state.quality_verification.get("status") or ""),
            limitations=state.quality_verification.get("limitations") or [],
            tool_names=sorted(state.used_tool_names)[:16],
            duration_ms=state.metrics_payload()["total_ms"],
        )
    except Exception:  # noqa: BLE001
        log.exception("Failed to record agent quality telemetry.")

    recovery = recovery_metadata(stable_error_code)
    error_payload = {
        "type": "error",
        "code": stable_error_code,
        "content_language": response_language,
        "trace_id": state.trace_id,
        "content": friendly_error,
        "retryable": recovery["retryable"],
        "recovery": recovery,
    }
    yield json.dumps(error_payload) + "\n"
    if not state.metrics_emitted:
        yield json.dumps(state.metrics_payload()) + "\n"
        state.metrics_emitted = True
    yield (
        json.dumps(
            {
                "type": "done",
                "trace_id": state.trace_id,
                "has_response": state.answer_count > 0,
                "message_count": state.answer_count,
            }
        )
        + "\n"
    )


async def finalize_agent_stream(
    *,
    state: AgentStreamState,
    confirmation_token: Any,
    vault_scope: str,
    workspace_context: WorkspaceContext,
    agent_id: str,
    session_id: str,
    chat_req: ChatRequest,
    cancel_token: str,
    turn_claimed: bool,
    chat_principal: str,
) -> None:
    if not state.stream_failed:
        try:
            await asyncio.to_thread(
                record_quality_signal,
                {
                    "vault_scope": vault_scope,
                    "workspace_id": workspace_context.workspace_id,
                    "user_id": workspace_context.user_id,
                },
                agent_id=agent_id,
                session_id=session_id,
                turn_id=chat_req.turn_id or state.trace_id,
                signal="turn",
                language=str(state.quality_plan.get("language") or "en"),
                mode=str(state.quality_plan.get("mode") or "analysis"),
                domains=state.quality_plan.get("domains") or [],
                route=str(state.quality_plan.get("route") or "General"),
                execution=str(state.quality_plan.get("execution") or "foreground"),
                output_strategy=str(state.quality_plan.get("output_strategy") or "model_synthesis"),
                required_tool=str(state.quality_plan.get("required_tool") or ""),
                verification_status=str(
                    state.quality_verification.get("status") or "not_applicable"
                ),
                limitations=state.quality_verification.get("limitations") or [],
                tool_names=sorted(state.used_tool_names)[:16],
                duration_ms=max(
                    0,
                    int((time.monotonic() - state.request_started_at) * 1000),
                ),
            )
        except Exception:  # noqa: BLE001
            log.exception("Failed to record completed agent turn telemetry.")
    reset_confirmation_context(confirmation_token)
    release_agent_turn(cancel_token)
    if turn_claimed and chat_req.turn_id:
        await asyncio.to_thread(
            finish_turn,
            vault_scope=vault_scope,
            workspace_id=workspace_context.workspace_id,
            user_id=chat_principal,
            agent_id=agent_id,
            session_id=session_id,
            turn_id=chat_req.turn_id,
        )
    await asyncio.to_thread(
        record_replay_event,
        state.trace_id,
        "completed",
        {
            "status": "completed",
            "duration_ms": max(
                0,
                int((time.monotonic() - state.request_started_at) * 1000),
            ),
            "model_calls": state.model_calls,
            "tool_calls": state.tool_calls_count,
            "verification_status": (state.quality_verification or {}).get("status"),
            "event_count": state.answer_count,
        },
    )

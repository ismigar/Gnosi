"""Request-scoped agent state, cancellation and governed tool policy."""

from __future__ import annotations

import logging
import operator
import time
from typing import Annotated, Any, Sequence, TypedDict

from langchain_core.messages import BaseMessage, ToolMessage
from langgraph.managed import RemainingSteps

from backend.agent.action_confirmations import (
    current_confirmation_scope,
    request_governed_tool_confirmation,
)
from backend.security.secret_redaction import redact_secrets
from backend.services.agent_cancellation import invoke_cancellable, is_cancelled
from backend.services.agent_capability_health import (
    record_capability_failure,
    record_capability_success,
)
from backend.services.agent_observability import span as observability_span
from backend.services.capability_audit import record_capability_event
from backend.services.tool_runtime import execute_contract, validate_arguments

log = logging.getLogger(__name__)


class AgentState(TypedDict):
    messages: Annotated[Sequence[BaseMessage], operator.add]
    next: str
    turn_authorized_tool_names: Sequence[str]
    active_skill_ids: Sequence[str]
    current_user_role: str
    turn_plan: dict[str, Any]
    remaining_steps: RemainingSteps
    cancel_token: str
    trace_id: str
    turn_started_at: float


def _turn_is_cancelled(state: Any) -> bool:
    """Read the request cancellation signal without capturing it in a graph."""
    token = (
        state.get("cancel_token", "")
        if isinstance(state, dict)
        else getattr(state, "cancel_token", "")
    )
    return bool(is_cancelled(str(token or "")))


def _invoke_agent_model(model: Any, prompt: Any, state: Any) -> Any:
    """Invoke a model with request cancellation when the graph has a token."""
    token = state.get("cancel_token", "") if isinstance(state, dict) else ""
    trace_id = state.get("trace_id", "") if isinstance(state, dict) else ""
    with observability_span(
        "agent.model",
        trace_id=str(trace_id or ""),
        attributes={"model": getattr(model, "model_name", "") or getattr(model, "model", "")},
    ):
        return invoke_cancellable(model, prompt, str(token or ""))


def _turn_authorized_tool_names(state: Any) -> set[str]:
    """Read current-turn tool grants from graph state.

    This state field is overwritten on every invocation. It must never be
    sourced from a workflow-construction closure because workflows are cached
    across turns.
    """
    if isinstance(state, dict):
        values = state.get("turn_authorized_tool_names") or []
    else:
        values = getattr(state, "turn_authorized_tool_names", []) or []
    return {str(value) for value in values if value}


def _normalize_tool_policies(tool_policies: Any) -> dict[str, dict[str, Any]]:
    """Normalize legacy name lists and descriptor-backed policy mappings."""
    if isinstance(tool_policies, dict):
        return {str(name): dict(policy or {}) for name, policy in tool_policies.items() if name}
    return {
        str(name): {
            "minimum_role": "editor",
            "confirmation": "explicit_request",
        }
        for name in tool_policies
        if name
    }


def _policy_message(tool_call: dict[str, Any], tool_name: str, content: str) -> ToolMessage:
    """Build the stable governed-tool response envelope."""
    return ToolMessage(
        content=content,
        name=tool_name,
        tool_call_id=str(tool_call.get("id") or ""),
        status="error",
    )


def _record_policy_audit(
    policy: dict[str, Any],
    tool_call: dict[str, Any],
    tool_name: str,
    status: str,
    *,
    result_kind: str = "none",
    error_code: str = "",
    duration_ms: int = 0,
) -> None:
    """Record policy metadata without making tool execution depend on audit I/O."""
    try:
        record_capability_event(
            current_confirmation_scope(),
            tool_id=str(policy.get("id") or tool_name),
            tool_name=tool_name,
            effects=list(policy.get("effects") or []),
            status=status,
            argument_keys=list((tool_call.get("args") or {}).keys()),
            result_kind=result_kind,
            error_code=error_code,
            duration_ms=duration_ms,
        )
    except Exception:
        log.exception("Failed to write capability audit metadata.")


def _authorization_denial(
    policy: dict[str, Any],
    tool_call: dict[str, Any],
    tool_name: str,
) -> ToolMessage:
    """Deny a governed tool that the current turn did not authorize."""
    _record_policy_audit(
        policy,
        tool_call,
        tool_name,
        "denied",
        error_code="explicit_authorization_required",
    )
    return _policy_message(
        tool_call,
        tool_name,
        f"Tool execution denied: the current user turn did not explicitly authorize `{tool_name}`.",
    )


def _execute_policy_tool(
    request: Any,
    execute: Any,
    policy: dict[str, Any],
    state: dict[str, Any],
    tool_call: dict[str, Any],
    tool_name: str,
    *,
    mode: str,
) -> Any:
    """Execute one validated tool and update health plus audit metadata."""
    started = time.monotonic()
    try:
        with observability_span(
            "agent.tool",
            trace_id=str(state.get("trace_id") or ""),
            attributes={"tool": tool_name, "mode": mode},
        ):
            result = execute_contract(
                request,
                execute,
                descriptor=policy.get("_descriptor"),
                timeout_seconds=policy.get("timeout_seconds", 120),
            )
    except Exception as error:
        duration_ms = int((time.monotonic() - started) * 1000)
        record_capability_failure(
            policy.get("_descriptor"),
            request,
            error_code=type(error).__name__,
            duration_ms=duration_ms,
        )
        if mode == "normal":
            _record_policy_audit(
                policy,
                tool_call,
                tool_name,
                "failed",
                error_code=type(error).__name__,
                duration_ms=duration_ms,
            )
        raise

    duration_ms = int((time.monotonic() - started) * 1000)
    failed = getattr(result, "status", "success") == "error"
    if failed:
        record_capability_failure(
            policy.get("_descriptor"),
            request,
            error_code="tool_result_error",
            duration_ms=duration_ms,
        )
    else:
        record_capability_success(
            policy.get("_descriptor"),
            request,
            duration_ms=duration_ms,
        )
    _record_policy_audit(
        policy,
        tool_call,
        tool_name,
        "failed" if failed else "completed",
        result_kind=type(result).__name__,
        duration_ms=duration_ms,
    )
    return result


def _prepare_policy_confirmation(
    request: Any,
    policy: dict[str, Any],
    state: dict[str, Any],
    tool_call: dict[str, Any],
    tool_name: str,
) -> ToolMessage:
    """Prepare the durable confirmation payload for an always-governed tool."""
    try:
        content = request_governed_tool_confirmation(
            descriptor=policy.get("_descriptor"),
            tool_name=tool_name,
            tool_arguments=dict(tool_call.get("args") or {}),
            active_skill_ids=(state.get("active_skill_ids") or ()),
        )
    except Exception as error:
        _record_policy_audit(
            policy,
            tool_call,
            tool_name,
            "failed",
            error_code=type(error).__name__,
        )
        return _policy_message(
            tool_call,
            tool_name,
            f"Tool confirmation preparation failed: {redact_secrets(error, max_chars=1_000)}",
        )
    _record_policy_audit(
        policy,
        tool_call,
        tool_name,
        "approval_required",
        result_kind="confirmation",
    )
    return ToolMessage(
        content=content,
        name=tool_name,
        tool_call_id=str(tool_call.get("id") or ""),
        status="success",
    )


def _always_confirmation_result(
    request: Any,
    execute: Any,
    policy: dict[str, Any],
    state: dict[str, Any],
    tool_call: dict[str, Any],
    tool_name: str,
) -> Any:
    """Execute an authorized preparation tool or return its confirmation."""
    if not policy.get("prepares_confirmation"):
        return _prepare_policy_confirmation(request, policy, state, tool_call, tool_name)
    if tool_name not in _turn_authorized_tool_names(request.state):
        return _authorization_denial(policy, tool_call, tool_name)
    return _execute_policy_tool(
        request,
        execute,
        policy,
        state,
        tool_call,
        tool_name,
        mode="authorized",
    )


def _tool_policy_wrapper(tool_policies: Any) -> Any:
    """Build a just-in-time execution gate for tool role and turn grants."""
    policies = _normalize_tool_policies(tool_policies)

    def enforce_policy(request: Any, execute: Any) -> Any:
        tool_call: dict[str, Any] = request.tool_call
        tool_name = str(tool_call.get("name") or "")
        policy = policies.get(tool_name, {})
        state = request.state if isinstance(request.state, dict) else {}
        arguments = dict(tool_call.get("args") or {})
        try:
            validate_arguments(arguments, policy.get("_descriptor"))
        except ValueError as error:
            _record_policy_audit(
                policy,
                tool_call,
                tool_name,
                "failed",
                result_kind="validation_error",
                error_code="invalid_arguments",
            )
            return _policy_message(tool_call, tool_name, f"Tool execution rejected: {error}")
        if _turn_is_cancelled(state):
            return _policy_message(
                tool_call,
                tool_name,
                "Tool execution cancelled because the client disconnected.",
            )
        current_role = str(state.get("current_user_role") or "viewer").lower()
        required_role = str(policy.get("minimum_role") or "viewer").lower()
        role_weights = {"viewer": 0, "editor": 1, "admin": 2, "owner": 3}
        if role_weights.get(current_role, -1) < role_weights.get(required_role, 0):
            _record_policy_audit(
                policy,
                tool_call,
                tool_name,
                "denied",
                error_code="insufficient_role",
            )
            return _policy_message(
                tool_call,
                tool_name,
                f"Tool execution denied: `{tool_name}` requires role `{required_role}`.",
            )
        confirmation = str(policy.get("confirmation") or "none")
        if confirmation == "always":
            return _always_confirmation_result(
                request, execute, policy, state, tool_call, tool_name
            )
        if confirmation not in {"", "never", "none"} and (
            tool_name not in _turn_authorized_tool_names(request.state)
        ):
            return _authorization_denial(policy, tool_call, tool_name)
        return _execute_policy_tool(
            request,
            execute,
            policy,
            state,
            tool_call,
            tool_name,
            mode="normal",
        )

    return enforce_policy

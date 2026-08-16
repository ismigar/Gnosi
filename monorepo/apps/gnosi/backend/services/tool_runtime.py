"""Runtime contract for bounded, observable tool calls."""
from __future__ import annotations

import concurrent.futures
import json
from typing import Any, Mapping

from langchain_core.messages import ToolMessage
from backend.security.secret_redaction import redact_secrets

MAX_ARGUMENT_KEYS = 64
MAX_ARGUMENT_VALUE_CHARS = 8_000
MAX_RESULT_CHARS = 32_000
MAX_TIMEOUT_SECONDS = 120
_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=16, thread_name_prefix="gnosi-tool")


def validate_arguments(arguments: Mapping[str, Any]) -> None:
    if len(arguments) > MAX_ARGUMENT_KEYS:
        raise ValueError("Tool arguments exceed the maximum number of fields.")
    for key, value in arguments.items():
        if len(str(key)) > 128:
            raise ValueError("Tool argument name is too long.")
        if len(json.dumps(value, ensure_ascii=False, default=str)) > MAX_ARGUMENT_VALUE_CHARS:
            raise ValueError(f"Tool argument `{key}` exceeds the bounded size limit.")


def bound_result(result: Any) -> Any:
    """Truncate tool content while preserving LangChain metadata."""
    if isinstance(result, ToolMessage):
        content = redact_secrets(result.content)
        if len(content) <= MAX_RESULT_CHARS:
            return result.model_copy(update={"content": content})
        return result.model_copy(update={
            "content": content[:MAX_RESULT_CHARS] + "\n[tool output truncated by runtime contract]",
        })
    if isinstance(result, str):
        return redact_secrets(result[:MAX_RESULT_CHARS])
    return result


def execute_bounded(request: Any, execute: Any, *, timeout_seconds: Any = 120) -> Any:
    """Run a synchronous tool with a hard response boundary.

    Python cannot safely kill a running thread; a timed-out call is therefore
    reported to the graph immediately and the worker remains isolated in a
    bounded executor until its provider returns.
    """
    try:
        timeout = max(1, min(int(timeout_seconds or 120), MAX_TIMEOUT_SECONDS))
    except (TypeError, ValueError):
        timeout = MAX_TIMEOUT_SECONDS
    future = _EXECUTOR.submit(execute, request)
    try:
        return bound_result(future.result(timeout=timeout))
    except concurrent.futures.TimeoutError as error:
        future.cancel()
        tool_call = getattr(request, "tool_call", {}) or {}
        return ToolMessage(
            content="Tool execution exceeded its timeout and was stopped.",
            name=str(tool_call.get("name") or "tool"),
            tool_call_id=str(tool_call.get("id") or ""),
            status="error",
        )

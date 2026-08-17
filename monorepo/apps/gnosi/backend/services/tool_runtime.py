"""Runtime contract for bounded, observable tool calls."""
from __future__ import annotations

import concurrent.futures
import json
from typing import Any, Callable, Mapping, Optional

from langchain_core.messages import ToolMessage
from backend.security.secret_redaction import redact_secrets

MAX_ARGUMENT_KEYS = 64
MAX_ARGUMENT_VALUE_CHARS = 8_000
MAX_RESULT_CHARS = 32_000
MAX_TIMEOUT_SECONDS = 120
_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=16, thread_name_prefix="gnosi-tool")
_COMPENSATORS: dict[str, Callable[[Any, BaseException], Any]] = {}


def _descriptor_value(descriptor: Any, field: str, default: Any = None) -> Any:
    if isinstance(descriptor, Mapping):
        return descriptor.get(field, default)
    return getattr(descriptor, field, default)


def validate_json_schema(value: Any, schema: Mapping[str, Any], *, path: str = "$", depth: int = 0) -> None:
    """Validate the bounded JSON-schema subset used by tool descriptors."""
    if depth > 8:
        raise ValueError(f"Tool schema nesting is too deep at {path}.")
    if not schema:
        return
    expected = schema.get("type")
    if isinstance(expected, list):
        if not any(type_name in {
            "object", "array", "string", "integer", "number", "boolean", "null",
        } and (
            (type_name == "object" and isinstance(value, Mapping))
            or (type_name == "array" and isinstance(value, list))
            or (type_name == "string" and isinstance(value, str))
            or (type_name == "integer" and isinstance(value, int) and not isinstance(value, bool))
            or (type_name == "number" and isinstance(value, (int, float)) and not isinstance(value, bool))
            or (type_name == "boolean" and isinstance(value, bool))
            or (type_name == "null" and value is None)
        ) for type_name in expected):
            raise ValueError(f"Tool value at {path} has an invalid type.")
        expected = None
    valid_types = {
        "object": isinstance(value, Mapping),
        "array": isinstance(value, list),
        "string": isinstance(value, str),
        "integer": isinstance(value, int) and not isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "boolean": isinstance(value, bool),
        "null": value is None,
    }
    if expected in valid_types and not valid_types[expected]:
        raise ValueError(f"Tool value at {path} must be {expected}.")
    if "enum" in schema and value not in list(schema.get("enum") or []):
        raise ValueError(f"Tool value at {path} is not an allowed option.")
    if isinstance(value, str):
        if "minLength" in schema and len(value) < int(schema["minLength"]):
            raise ValueError(f"Tool value at {path} is too short.")
        if "maxLength" in schema and len(value) > int(schema["maxLength"]):
            raise ValueError(f"Tool value at {path} is too long.")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            raise ValueError(f"Tool value at {path} is below the minimum.")
        if "maximum" in schema and value > schema["maximum"]:
            raise ValueError(f"Tool value at {path} exceeds the maximum.")
    if isinstance(value, Mapping):
        properties = schema.get("properties") if isinstance(schema.get("properties"), Mapping) else {}
        required = set(schema.get("required") or [])
        missing = sorted(str(key) for key in required if key not in value)
        if missing:
            raise ValueError(f"Tool arguments missing required fields: {', '.join(missing)}.")
        if schema.get("additionalProperties") is False:
            unknown = sorted(str(key) for key in value if key not in properties)
            if unknown:
                raise ValueError(f"Tool arguments contain unknown fields: {', '.join(unknown[:8])}.")
        for key, child_schema in list(properties.items())[:MAX_ARGUMENT_KEYS]:
            if key in value and isinstance(child_schema, Mapping):
                validate_json_schema(value[key], child_schema, path=f"{path}.{key}", depth=depth + 1)
    if isinstance(value, list) and isinstance(schema.get("items"), Mapping):
        for index, item in enumerate(value[:MAX_ARGUMENT_KEYS]):
            validate_json_schema(item, schema["items"], path=f"{path}[{index}]", depth=depth + 1)


def validate_arguments(arguments: Mapping[str, Any], descriptor: Any = None) -> None:
    if len(arguments) > MAX_ARGUMENT_KEYS:
        raise ValueError("Tool arguments exceed the maximum number of fields.")
    for key, value in arguments.items():
        if len(str(key)) > 128:
            raise ValueError("Tool argument name is too long.")
        if len(json.dumps(value, ensure_ascii=False, default=str)) > MAX_ARGUMENT_VALUE_CHARS:
            raise ValueError(f"Tool argument `{key}` exceeds the bounded size limit.")
    schema = _descriptor_value(descriptor, "input_schema", {}) if descriptor is not None else {}
    if isinstance(schema, Mapping):
        validate_json_schema(arguments, schema)


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


def register_compensator(tool_name: str, callback: Callable[[Any, BaseException], Any]) -> None:
    """Register an explicit, reviewed compensation handler for one tool."""
    if not callable(callback):
        raise TypeError("A tool compensator must be callable.")
    _COMPENSATORS[str(tool_name)[:128]] = callback


def execute_contract(
    request: Any,
    execute: Any,
    *,
    descriptor: Any = None,
    timeout_seconds: Any = 120,
) -> Any:
    """Validate input/output schemas and run an optional reviewed compensator."""
    tool_call = getattr(request, "tool_call", {}) or {}
    tool_name = str(tool_call.get("name") or "tool")
    arguments = dict(tool_call.get("args") or {})
    validate_arguments(arguments, descriptor)
    try:
        result = execute_bounded(request, execute, timeout_seconds=timeout_seconds)
        output_schema = _descriptor_value(descriptor, "output_schema", {}) if descriptor is not None else {}
        if output_schema and not isinstance(result, ToolMessage):
            validate_json_schema(result, output_schema)
        return result
    except Exception as error:
        compensator = _COMPENSATORS.get(tool_name)
        if compensator:
            try:
                compensator(arguments, error)
            except Exception:
                pass
        raise

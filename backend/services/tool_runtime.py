"""Compatibility exports for the agent-domain tool runtime."""

from __future__ import annotations

from backend.domains.agent.tool_runtime import (
    _COMPENSATORS,
    _EXECUTOR,
    MAX_ARGUMENT_KEYS,
    MAX_ARGUMENT_VALUE_CHARS,
    MAX_RESULT_CHARS,
    MAX_TIMEOUT_SECONDS,
    _descriptor_value,
    bound_result,
    execute_bounded,
    execute_contract,
    register_compensator,
    validate_arguments,
    validate_json_schema,
)

__all__ = [
    "MAX_ARGUMENT_KEYS",
    "MAX_ARGUMENT_VALUE_CHARS",
    "MAX_RESULT_CHARS",
    "MAX_TIMEOUT_SECONDS",
    "_COMPENSATORS",
    "_EXECUTOR",
    "_descriptor_value",
    "bound_result",
    "execute_bounded",
    "execute_contract",
    "register_compensator",
    "validate_arguments",
    "validate_json_schema",
]

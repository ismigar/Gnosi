"""Expose approved generated tools to skills without granting them globally."""

from __future__ import annotations

import ast
import inspect
import re
from typing import Any

from backend.agent.generated_tools.loader import loader
from backend.agent.generated_tools.registry import registry
from backend.models.agent_skills import ConfirmationPolicy, ToolEffect
from backend.services.agent_skill_catalog import (
    ToolRegistration,
    register_generated_tool_provider,
)


def _stable_id(name: str) -> str:
    normalized = re.sub(r"[^a-z0-9._-]+", "-", str(name).strip().lower())
    normalized = normalized.strip(".-_")
    return f"generated.{normalized}"


def _annotation_type(node: ast.expr | None) -> type:
    name = getattr(node, "id", "")
    return {
        "str": str,
        "int": int,
        "float": float,
        "bool": bool,
        "list": list,
        "dict": dict,
    }.get(name, Any)


def _code_signature(code: str) -> tuple[inspect.Signature, dict]:
    """Derive a conservative schema without executing approved Python."""

    try:
        tree = ast.parse(code)
    except SyntaxError:
        return inspect.Signature(), {"type": "object", "properties": {}}
    function = next(
        (
            node
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and not node.name.startswith("_")
        ),
        None,
    )
    if function is None:
        return inspect.Signature(), {"type": "object", "properties": {}}
    positional = list(function.args.posonlyargs) + list(function.args.args)
    default_offset = len(positional) - len(function.args.defaults)
    properties = {}
    required = []
    parameters = []
    for index, argument in enumerate(positional):
        if argument.arg in {"self", "run_manager"}:
            continue
        annotation = _annotation_type(argument.annotation)
        default_node = (
            function.args.defaults[index - default_offset]
            if index >= default_offset
            else None
        )
        default = inspect.Parameter.empty
        if default_node is not None:
            try:
                default = ast.literal_eval(default_node)
            except (ValueError, TypeError):
                default = None
        if default is inspect.Parameter.empty:
            required.append(argument.arg)
        properties[argument.arg] = {
            "type": {
                str: "string",
                int: "integer",
                float: "number",
                bool: "boolean",
                list: "array",
                dict: "object",
            }.get(annotation, "string")
        }
        parameters.append(
            inspect.Parameter(
                argument.arg,
                inspect.Parameter.KEYWORD_ONLY,
                default=default,
                annotation=annotation,
            )
        )
    return inspect.Signature(parameters), {
        "type": "object",
        "properties": properties,
        "required": required,
    }


def _lazy_handler(record):
    signature, _schema = _code_signature(record.code)

    def invoke(**arguments):
        handler = loader.load_approved_record(record)
        if handler is None:
            raise RuntimeError(f"Approved generated tool {record.name!r} cannot load")
        if callable(getattr(handler, "invoke", None)):
            return handler.invoke(arguments)
        return handler(**arguments)

    invoke.__name__ = re.sub(r"[^A-Za-z0-9_]", "_", _stable_id(record.name))
    invoke.__doc__ = record.description
    invoke.__signature__ = signature
    return invoke


def _approved_tools():
    registrations = []
    for record in registry.list_approved():
        tool_id = _stable_id(record.name)
        if tool_id == "generated.":
            continue
        _signature, input_schema = _code_signature(record.code)
        registrations.append(
            ToolRegistration(
                descriptor={
                    "id": tool_id,
                    "name": record.name,
                    "description": record.description,
                    "version": "1.0.0",
                    "input_schema": input_schema,
                    # Approved Python still executes in the application
                    # process. Treat it conservatively until generated tools
                    # move to a process sandbox.
                    "effects": [
                        ToolEffect.LOCAL_WRITE,
                        ToolEffect.CODE_EXECUTION,
                    ],
                    "minimum_role": "admin",
                    "confirmation": ConfirmationPolicy.ALWAYS,
                    "handler_ref": f"generated:{record.name}",
                    "metadata": {
                        "approval_status": "approved",
                        "risk_level": record.risk_level,
                        "approved_at": record.approved_at,
                    },
                },
                handler=_lazy_handler(record),
            )
        )
    return registrations


def register_generated_tool_contributions() -> None:
    """Register the lazy adapter for the generated-tool approval registry."""

    register_generated_tool_provider("approval-registry", _approved_tools)

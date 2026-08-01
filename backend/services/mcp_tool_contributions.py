"""Governed read-only MCP tools exposed for explicit skill composition."""

from __future__ import annotations

import re
import threading
from typing import Any, Iterable

from backend.agent.tools import create_mcp_tool
from backend.models.agent_skills import ConfirmationPolicy, ToolEffect
from backend.services.agent_skill_catalog import (
    ToolRegistration,
    register_mcp_tool_provider,
)

_lock = threading.RLock()
_definitions: tuple[dict[str, Any], ...] = ()
_client: Any = None


def _safe_segment(value: Any, fallback: str) -> str:
    segment = re.sub(r"[^a-z0-9_-]+", "-", str(value or "").strip().lower())
    return segment.strip("-_") or fallback


def _provider() -> Iterable[ToolRegistration]:
    with _lock:
        definitions = _definitions
        client = _client
    if client is None:
        return ()
    registrations = []
    for definition in definitions:
        annotations = definition.get("annotations") or {}
        if (
            annotations.get("readOnlyHint") is not True
            or annotations.get("destructiveHint") is True
        ):
            continue
        raw_name = str(definition.get("name") or "").strip()
        if not raw_name:
            continue
        server = _safe_segment(definition.get("server"), "connector")
        local_name = _safe_segment(raw_name, "tool")
        tool_id = f"mcp.{server}.{local_name}"
        exposed_name = re.sub(r"[^A-Za-z0-9_]", "_", tool_id)
        handler = create_mcp_tool(
            definition,
            client,
            exposed_name=exposed_name,
            server_name=str(definition.get("server") or ""),
        )
        registrations.append(
            ToolRegistration(
                descriptor={
                    "id": tool_id,
                    "_origin_id": server,
                    "name": str(definition.get("title") or raw_name),
                    "description": str(definition.get("description") or ""),
                    "input_schema": definition.get("inputSchema") or {
                        "type": "object",
                        "properties": {},
                    },
                    "effects": [ToolEffect.READ],
                    "minimum_role": "viewer",
                    "confirmation": ConfirmationPolicy.NONE,
                    "handler_ref": f"mcp:{server}:{raw_name}",
                    "metadata": {
                        "server": str(definition.get("server") or ""),
                        "mcp_tool_name": raw_name,
                        "annotations": annotations,
                    },
                },
                handler=handler,
            )
        )
    return registrations


def refresh_mcp_tool_contributions(
    definitions: Iterable[dict[str, Any]],
    client: Any,
) -> None:
    """Replace the MCP snapshot; only annotated read-only tools become eligible."""

    global _definitions, _client
    with _lock:
        _definitions = tuple(
            dict(value)
            for value in (definitions or ())
            if isinstance(value, dict)
        )
        _client = client
    register_mcp_tool_provider("runtime-connectors", _provider)

"""Host-authorized MCP capabilities exposed through the governed catalog."""

from __future__ import annotations

from copy import deepcopy
import logging
import re
import threading
from typing import Any, Iterable

from jsonschema.exceptions import SchemaError

from backend.agent.tools import create_mcp_tool
from backend.models.agent_skills import (
    CatalogOrigin,
    ConfirmationPolicy,
    OriginType,
    ToolDescriptor,
    ToolEffect,
)
from backend.services.agent_skill_catalog import (
    ToolRegistration,
    register_mcp_tool_provider,
)

_lock = threading.RLock()
_definitions: tuple[dict[str, Any], ...] = ()
_client: Any = None
_policies: dict[tuple[str, str], dict[str, Any]] = {}
log = logging.getLogger(__name__)


def _safe_segment(value: Any, fallback: str) -> str:
    segment = re.sub(r"[^a-z0-9_-]+", "-", str(value or "").strip().lower())
    return segment.strip("-_") or fallback


def _provider() -> Iterable[ToolRegistration]:
    with _lock:
        definitions = _definitions
        client = _client
        policies = deepcopy(_policies)
    if client is None:
        return ()
    registrations: list[ToolRegistration] = []
    for definition in definitions:
        annotations = definition.get("annotations") or {}
        raw_name = str(definition.get("name") or "").strip()
        if not raw_name:
            continue
        policy = policies.get((str(definition.get("server") or ""), raw_name))
        if not isinstance(policy, dict) or not {"effects", "minimum_role", "confirmation"}.issubset(policy):
            continue
        try:
            effects = [ToolEffect(value) for value in policy["effects"]]
            confirmation = ConfirmationPolicy(policy["confirmation"])
            if set(effects) - {ToolEffect.READ, ToolEffect.EXTERNAL_READ, ToolEffect.PERSONAL_DATA} and str(policy["minimum_role"]).strip().lower() == "viewer":
                raise ValueError("MCP consequential tools require editor or higher")
        except (ValueError, TypeError):
            log.warning("Skipping MCP tool with invalid host policy: %s", raw_name)
            continue
        server = _safe_segment(definition.get("server"), "connector")
        local_name = _safe_segment(raw_name, "tool")
        tool_id = f"mcp.{server}.{local_name}"
        exposed_name = re.sub(r"[^A-Za-z0-9_]", "_", tool_id)
        try:
            handler = create_mcp_tool(
                definition,
                client,
                exposed_name=exposed_name,
                server_name=str(definition.get("server") or ""),
            )
            raw_schema = definition.get("inputSchema")
            input_schema = (
                dict(raw_schema)
                if isinstance(raw_schema, dict)
                else {"type": "object", "properties": {}}
            )
            registrations.append(
                ToolRegistration(
                    descriptor=ToolDescriptor(
                        id=tool_id,
                        origin=CatalogOrigin(type=OriginType.MCP, id=server),
                        name=str(definition.get("title") or raw_name),
                        description=str(definition.get("description") or ""),
                        input_schema=input_schema,
                        effects=effects,
                        minimum_role=policy["minimum_role"],
                        confirmation=confirmation,
                        handler_ref=f"mcp:{server}:{raw_name}",
                        metadata={
                            "server": str(definition.get("server") or ""),
                            "mcp_tool_name": raw_name,
                            "annotations": annotations,
                        },
                    ),
                    handler=handler,
                )
            )
        except (ValueError, TypeError, SchemaError) as error:
            log.warning("Skipping malformed MCP capability %s: %s", raw_name, error)
    return registrations


def refresh_mcp_tool_contributions(
    definitions: Iterable[dict[str, Any]],
    client: Any,
    *,
    trusted_policies: dict[tuple[str, str], dict[str, Any]] | None = None,
) -> None:
    """Replace the MCP snapshot using policies supplied by the trusted host.

    Never pass policy fields received from an MCP server here. Runtime defaults
    come from local configuration, separate from untrusted tool definitions.
    """

    global _definitions, _client, _policies
    if trusted_policies is None:
        from backend.config.mcp_config import MCP_TOOL_POLICIES
        trusted_policies = MCP_TOOL_POLICIES
    with _lock:
        _definitions = tuple(
            deepcopy(value)
            for value in (definitions or ())
            if isinstance(value, dict)
        )
        _client = client
        _policies = deepcopy(trusted_policies)
    register_mcp_tool_provider("runtime-connectors", _provider)

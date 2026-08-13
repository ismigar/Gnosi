"""MCP tools require read-only annotations before skills can reference them."""

import asyncio

from backend.services.agent_skill_catalog import get_tool_catalog
from backend.services.mcp_tool_contributions import (
    refresh_mcp_tool_contributions,
)


class _Client:
    async def call_server_tool(self, server, name, arguments):
        return {"server": server, "name": name, "arguments": arguments}


def test_only_annotated_read_only_mcp_tools_enter_governed_catalog():
    client = _Client()
    refresh_mcp_tool_contributions(
        [
            {
                "server": "mail",
                "name": "search_messages",
                "description": "Search mail.",
                "annotations": {"readOnlyHint": True},
                "inputSchema": {
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                },
            },
            {
                "server": "mail",
                "name": "delete_message",
                "annotations": {"destructiveHint": True},
            },
            {
                "server": "legacy",
                "name": "unknown_effect",
            },
        ],
        client,
    )

    catalog = get_tool_catalog()
    descriptor = catalog.get("mcp.mail.search_messages")
    assert descriptor is not None
    assert [effect.value for effect in descriptor.effects] == ["read"]
    assert catalog.get("mcp.mail.delete_message") is None
    assert catalog.get("mcp.legacy.unknown_effect") is None

    handler = catalog.get_handler("mcp.mail.search_messages")
    result = asyncio.run(handler.ainvoke({"query": "invoice"}))
    assert result == {
        "server": "mail",
        "name": "search_messages",
        "arguments": {"query": "invoice"},
    }

    refresh_mcp_tool_contributions([], None)

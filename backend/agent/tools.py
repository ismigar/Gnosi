import logging
from typing import Any
from langchain_core.tools import StructuredTool
from copy import deepcopy

from backend.services.mcp_contracts import compile_mcp_schema, validate_mcp_value
from backend.mcp.client import MultiServerMCPClient

log = logging.getLogger(__name__)

class MCPStructuredTool(StructuredTool):
    """Executable MCP handler whose original schema must survive binding."""


def provider_tool_definitions(tools: list[Any]) -> list[Any]:
    """Bypass LangChain's lossy dereferencing only for validated MCP schemas."""
    return [
        {"type": "function", "function": {
            "name": tool.name, "description": tool.description,
            "parameters": deepcopy(tool.args_schema),
        }} if isinstance(tool, MCPStructuredTool) else tool
        for tool in tools
    ]


def bind_model_tools(model: Any, tools: list[Any], **kwargs: Any) -> Any:
    """Bind exact MCP contracts while keeping executable tools in the graph."""
    return model.bind_tools(provider_tool_definitions(tools), **kwargs)


def create_mcp_tool(
    tool_def: dict[str, Any],
    client: MultiServerMCPClient,
    *,
    exposed_name: str | None = None,
    server_name: str | None = None,
) -> StructuredTool:
    """
    Creates a LangChain tool from an MCP definition.
    """
    name = tool_def["name"]
    if not isinstance(name, str) or not name.strip():
        raise ValueError("MCP tool name must be a nonempty string")
    description = str(tool_def.get("description", ""))
    raw_schema = tool_def.get("inputSchema")
    if raw_schema is not None and not isinstance(raw_schema, dict):
        raise ValueError("MCP inputSchema must be an object")
    schema_def = deepcopy(raw_schema if raw_schema is not None else {"type": "object", "properties": {}})
    validator = compile_mcp_schema(schema_def)

    async def tool_func(**kwargs: Any) -> Any:
        # Validate the original values without Pydantic coercion or synthesized
        # defaults. A missing optional argument must remain absent, not null.
        validate_mcp_value(kwargs, validator)
        if server_name:
            return await client.call_server_tool(server_name, name, kwargs)
        return await client.call_tool(name, kwargs)

    return MCPStructuredTool.from_function(
        func=None,
        coroutine=tool_func,
        name=exposed_name or name,
        description=description,
        args_schema=schema_def
    )

def get_mcp_tools(
    tools_list: list[Any] | None,
    client: MultiServerMCPClient,
) -> list[StructuredTool]:
    """Converts MCP definitions into LangChain tools, ISOLATING errors.

    The definitions come from THIRD-PARTY MCP servers (Notion, etc.). A single
    malformed one (missing `name`, odd schema…) must NOT bring down the rest
    or the whole agent: previously the list comprehension propagated the exception and
    `get_mcp_tools` would fail → the agent was left WITHOUT ANY MCP tool (or wouldn't
    start). Now each tool goes in its own try/except and bad ones are skipped
    with a log entry."""
    tools: list[StructuredTool] = []
    for t in tools_list or []:
        try:
            if not isinstance(t, dict):
                raise TypeError("MCP tool definition must be an object")
            tools.append(create_mcp_tool(t, client))
        except Exception as e:
            log.warning(
                "Skipping malformed MCP tool %r: %s",
                (t or {}).get("name", "?") if isinstance(t, dict) else "?",
                e,
            )
    return tools

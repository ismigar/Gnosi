import logging
from typing import Any
from langchain_core.tools import StructuredTool
from pydantic import create_model
from backend.mcp.client import MultiServerMCPClient

log = logging.getLogger(__name__)

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
    name = str(tool_def["name"])
    description = str(tool_def.get("description", ""))
    raw_schema = tool_def.get("inputSchema")
    schema_def = raw_schema if isinstance(raw_schema, dict) else {}
    
    # Build dynamic Pydantic model for arguments
    fields: dict[str, Any] = {}
    # `required` from the MCP's JSON Schema: fields that are NOT there must be OPTIONAL.
    # Previously ALL were marked as required (`...`), so an MCP tool with
    # optional parameters (e.g. `limit`, `encoding`) would fail Pydantic validation
    # of the args_schema when the LLM omitted them → the tool call was rejected.
    required = set(schema_def.get("required", []) or [])
    properties = schema_def.get("properties")
    if isinstance(properties, dict):
        for prop_name, _prop_schema in properties.items():
            # Simplification: the type stays as Any (the full JSON mapping
            # Schema→Pydantic by type is still pending). But we DO respect `required`.
            normalized_name = str(prop_name)
            if normalized_name in required:
                fields[normalized_name] = (Any, ...)   # obligatori
            else:
                fields[normalized_name] = (Any, None)  # opcional (default None)
    
    # If no schema, use empty model
    ArgsModel = create_model(f"{name}_args", **fields)

    async def tool_func(**kwargs: Any) -> Any:
        # This function will be called by the agent when it uses the tool
        if server_name:
            return await client.call_server_tool(server_name, name, kwargs)
        return await client.call_tool(name, kwargs)

    return StructuredTool.from_function(
        func=None,
        coroutine=tool_func,
        name=exposed_name or name,
        description=description,
        args_schema=ArgsModel
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

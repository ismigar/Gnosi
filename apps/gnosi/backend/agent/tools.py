import logging
from typing import List, Dict, Any, Callable
from langchain_core.tools import StructuredTool
from pydantic import create_model
from backend.mcp.client import MultiServerMCPClient

log = logging.getLogger(__name__)

def create_mcp_tool(tool_def: Dict[str, Any], client: MultiServerMCPClient) -> StructuredTool:
    """
    Creates a LangChain tool from an MCP definition.
    """
    name = tool_def["name"]
    description = tool_def.get("description", "")
    schema_def = tool_def.get("inputSchema", {})
    
    # Build dynamic Pydantic model for arguments
    fields = {}
    # `required` from the MCP's JSON Schema: fields that are NOT there must be OPTIONAL.
    # Previously ALL were marked as required (`...`), so an MCP tool with
    # optional parameters (e.g. `limit`, `encoding`) would fail Pydantic validation
    # of the args_schema when the LLM omitted them → the tool call was rejected.
    required = set(schema_def.get("required", []) or [])
    if "properties" in schema_def:
        for prop_name, prop_schema in schema_def["properties"].items():
            # Simplification: the type stays as Any (the full JSON mapping
            # Schema→Pydantic by type is still pending). But we DO respect `required`.
            if prop_name in required:
                fields[prop_name] = (Any, ...)   # obligatori
            else:
                fields[prop_name] = (Any, None)  # opcional (default None)
    
    # If no schema, use empty model
    ArgsModel = create_model(f"{name}_args", **fields)

    async def tool_func(**kwargs):
        # This function will be called by the agent when it uses the tool
        return await client.call_tool(name, kwargs)

    return StructuredTool.from_function(
        func=None,
        coroutine=tool_func,
        name=name,
        description=description,
        args_schema=ArgsModel
    )

def get_mcp_tools(tools_list: List[Dict], client: MultiServerMCPClient) -> List[StructuredTool]:
    """Converts MCP definitions into LangChain tools, ISOLATING errors.

    The definitions come from THIRD-PARTY MCP servers (Notion, etc.). A single
    malformed one (missing `name`, odd schema…) must NOT bring down the rest
    or the whole agent: previously the list comprehension propagated the exception and
    `get_mcp_tools` would fail → the agent was left WITHOUT ANY MCP tool (or wouldn't
    start). Now each tool goes in its own try/except and bad ones are skipped
    with a log entry."""
    tools: List[StructuredTool] = []
    for t in tools_list or []:
        try:
            tools.append(create_mcp_tool(t, client))
        except Exception as e:
            log.warning(
                "S'omet una tool MCP mal formada %r: %s",
                (t or {}).get("name", "?") if isinstance(t, dict) else "?",
                e,
            )
    return tools

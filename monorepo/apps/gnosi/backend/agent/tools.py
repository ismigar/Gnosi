from typing import List, Dict, Any, Callable
from langchain_core.tools import StructuredTool
from pydantic import create_model
from backend.mcp.client import MultiServerMCPClient

def create_mcp_tool(tool_def: Dict[str, Any], client: MultiServerMCPClient) -> StructuredTool:
    """
    Creates a LangChain tool from an MCP definition.
    """
    name = tool_def["name"]
    description = tool_def.get("description", "")
    schema_def = tool_def.get("inputSchema", {})
    
    # Build dynamic Pydantic model for arguments
    fields = {}
    if "properties" in schema_def:
        for prop_name, prop_schema in schema_def["properties"].items():
            # Simplification: All fields are string by default if no type is detected
            # For a robust implementation, standard mapping from JSON Schema to Pydantic is needed.
            # For Phase 2, we assume basic strings/ints.
            fields[prop_name] = (Any, ...) # Required by default for simplicity
    
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
    return [create_mcp_tool(t, client) for t in tools_list]

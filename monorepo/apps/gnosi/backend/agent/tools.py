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
    # `required` del JSON Schema de l'MCP: els camps que NO hi són han de ser OPCIONALS.
    # Abans es marcaven TOTS com a obligatoris (`...`), de manera que una tool MCP amb
    # paràmetres opcionals (p. ex. `limit`, `encoding`) feia fallar la validació Pydantic
    # de l'args_schema quan l'LLM els ometia → la crida a la tool es rebutjava.
    required = set(schema_def.get("required", []) or [])
    if "properties" in schema_def:
        for prop_name, prop_schema in schema_def["properties"].items():
            # Simplification: el tipus es queda com a Any (el mapatge complet JSON
            # Schema→Pydantic per tipus queda pendent). Però SÍ respectem `required`.
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
    return [create_mcp_tool(t, client) for t in tools_list]

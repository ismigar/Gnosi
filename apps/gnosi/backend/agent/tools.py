from typing import List, Dict, Any, Callable
from langchain_core.tools import StructuredTool
from pydantic import create_model
from backend.mcp.client import MultiServerMCPClient

def create_mcp_tool(tool_def: Dict[str, Any], client: MultiServerMCPClient) -> StructuredTool:
    """
    Crea una eina de LangChain a partir d'una definició MCP.
    """
    name = tool_def["name"]
    description = tool_def.get("description", "")
    schema_def = tool_def.get("inputSchema", {})
    
    # Construir model Pydantic dinàmic per als arguments
    fields = {}
    if "properties" in schema_def:
        for prop_name, prop_schema in schema_def["properties"].items():
            # Simplificació: Tots els camps string per defecte si no es detecta tipus
            # Per una implementació robusta caldria mapejar JSON Schema a Pydantic types recursivament.
            # Per la Fase 2, assumim strings/ints bàsics.
            fields[prop_name] = (Any, ...) # Required per defecte per simplicitat
    
    # Si no hi ha schema, usem model buit
    ArgsModel = create_model(f"{name}_args", **fields)

    async def tool_func(**kwargs):
        # Aquesta funció serà cridada per l'agent quan usi l'eina
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

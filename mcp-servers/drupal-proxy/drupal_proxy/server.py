import asyncio
import logging
import sys
from typing import Any, Sequence

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, ImageContent, EmbeddedResource
import mcp.types as types

from .client import DrupalClient
from .search import ToolSearcher

# Configure logging to stderr to avoid polluting stdio transport
logging.basicConfig(stream=sys.stderr, level=logging.INFO)
logger = logging.getLogger("drupal-proxy")

class DrupalProxyServer:
    def __init__(self):
        self.server = Server("drupal-proxy")
        self.client = DrupalClient()
        self.searcher = ToolSearcher(self.client.config)
        
        # Register handlers
        self.server.list_tools()(self.list_tools)
        self.server.call_tool()(self.call_tool)

    async def list_tools(self) -> list[types.Tool]:
        return [
            types.Tool(
                name="drupal_search_tools",
                description="Search for available Drupal tools by name or description. Use this to find the right tool for a task.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Search query (e.g. 'create node', 'list users')"
                        },
                        "limit": {
                            "type": "integer", 
                            "default": 10,
                            "description": "Max number of results to return"
                        }
                    },
                    "required": ["query"]
                }
            ),
            types.Tool(
                name="drupal_execute_tool",
                description="Execute a specific Drupal tool. You should first search for the tool to get its name and schema.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tool_name": {
                            "type": "string",
                            "description": "The exact name of the tool to execute"
                        },
                        "arguments": {
                            "type": "object",
                            "description": "The arguments to pass to the tool"
                        }
                    },
                    "required": ["tool_name"]
                }
            ),
            types.Tool(
                name="drupal_list_categories",
                description="List available tool categories/groups in Drupal.",
                inputSchema={
                    "type": "object",
                    "properties": {},
                }
            ),
            types.Tool(
                name="drupal_get_tool_schema",
                description="Get the input schema for a specific Drupal tool to know what arguments it requires.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "tool_name": {
                            "type": "string",
                            "description": "The exact name of the tool"
                        }
                    },
                    "required": ["tool_name"]
                }
            )
        ]

    async def call_tool(self, name: str, arguments: dict) -> list[types.TextContent | types.ImageContent | types.EmbeddedResource]:
        try:
            if name == "drupal_search_tools":
                return await self._handle_search(arguments)
            elif name == "drupal_execute_tool":
                return await self._handle_execute(arguments)
            elif name == "drupal_list_categories":
                return await self._handle_list_categories()
            elif name == "drupal_get_tool_schema":
                return await self._handle_get_schema(arguments)
            else:
                raise ValueError(f"Unknown tool: {name}")
        except Exception as e:
            logger.error(f"Error executing tool {name}: {e}")
            return [types.TextContent(type="text", text=f"Error: {str(e)}")]

    async def _handle_search(self, args: dict) -> list[types.TextContent]:
        query = args.get("query")
        limit = args.get("limit", 10)
        
        tools = await self.client.list_tools()
        results = self.searcher.search(query, tools)
        
        # Format results for LLM
        output = "Found tools:\n\n"
        for item in results[:limit]:
            tool = item['tool']
            score = item['score']
            description = tool.description if hasattr(tool, 'description') else tool.get('description', 'No description')
            tool_name = tool.name if hasattr(tool, 'name') else tool.get('name')
            
            output += f"- **{tool_name}** (Match: {score}%)\n"
            output += f"  {description}\n"
            
        return [types.TextContent(type="text", text=output)]

    async def _handle_execute(self, args: dict) -> list[types.TextContent | types.ImageContent | types.EmbeddedResource]:
        tool_name = args.get("tool_name")
        tool_args = args.get("arguments", {})
        
        logger.info(f"Proxy executing {tool_name} with args {tool_args}")
        result = await self.client.call_tool(tool_name, tool_args)
        
        # The result from mcp client call_tool is already a Result object with content list
        return result.content

    async def _handle_list_categories(self) -> list[types.TextContent]:
        tools = await self.client.list_tools()
        categories = set()
        
        for tool in tools:
            # Try to find group/category in extra attributes or annotations
            # Note: The Tool model might store extra fields differently depending on SDK version
            # Assuming 'group' might be in description or a specific field if accessible
            # If not easily accessible, we might skip or try to parse
            pass
            
        # Since standard Tool object doesn't strictly enforce 'group', we might just return a count summary
        return [types.TextContent(type="text", text=f"Total tools available: {len(tools)}. (Category listing not fully implemented yet due to schema variability)")]

    async def _handle_get_schema(self, args: dict) -> list[types.TextContent]:
        tool_name = args.get("tool_name")
        tool = await self.client.get_tool(tool_name)
        
        if not tool:
            return [types.TextContent(type="text", text=f"Tool '{tool_name}' not found.")]
            
        schema = tool.inputSchema if hasattr(tool, 'inputSchema') else tool.get('inputSchema')
        return [types.TextContent(type="text", text=json.dumps(schema, indent=2))]

    async def run(self):
        async with stdio_server() as (read_stream, write_stream):
            await self.server.run(
                read_stream,
                write_stream,
                self.server.create_initialization_options()
            )

def main():
    server = DrupalProxyServer()
    asyncio.run(server.run())

if __name__ == "__main__":
    main()

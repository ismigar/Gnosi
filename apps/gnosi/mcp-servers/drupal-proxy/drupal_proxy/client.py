import asyncio
import json
import logging
import os
import yaml
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DrupalClient:
    def __init__(self, config_path: str = "config.yaml"):
        self.config = self._load_config(config_path)
        self.session: Optional[ClientSession] = None
        self._exit_stack = None
        self.tools_cache: List[Any] = []
        self.cache_last_updated: Optional[datetime] = None

    def _load_config(self, path: str) -> dict:
        if not os.path.exists(path):
            # Fallback for relative path
            path = os.path.join(os.path.dirname(os.path.dirname(__file__)), path)
        
        with open(path, 'r') as f:
            return yaml.safe_load(f)

    async def connect(self):
        """Establish connection to the upstream MCP server."""
        server_config = self.config['mcp_server']
        server_params = StdioServerParameters(
            command=server_config['command'],
            args=server_config['args'],
            env={**os.environ, **server_config.get('env', {})}
        )

        logger.info(f"Connecting to Drupal MCP: {server_config['command']} {' '.join(server_config['args'])}")
        
        self._stdio_ctx = stdio_client(server_params)
        self.read_stream, self.write_stream = await self._stdio_ctx.__aenter__()
        
        self.session = ClientSession(self.read_stream, self.write_stream)
        await self.session.__aenter__()
        
        await self.session.initialize()
        logger.info("Connected and initialized with Drupal MCP")

    async def close(self):
        if self.session:
            await self.session.__aexit__(None, None, None)
        if hasattr(self, '_stdio_ctx'):
            await self._stdio_ctx.__aexit__(None, None, None)

    async def ensure_connected(self):
        if not self.session:
            await self.connect()

    async def list_tools(self, force_refresh: bool = False) -> List[Any]:
        """List all tools available in Drupal, with caching."""
        await self.ensure_connected()
        
        cache_config = self.config.get('cache', {})
        ttl = cache_config.get('ttl_seconds', 3600)
        
        now = datetime.now()
        if (not force_refresh and 
            self.tools_cache and 
            self.cache_last_updated and 
            (now - self.cache_last_updated).total_seconds() < ttl):
            return self.tools_cache

        logger.info("Fetching tools from Drupal MCP...")
        result = await self.session.list_tools()
        self.tools_cache = result.tools
        self.cache_last_updated = now
        
        # Save cache to file if enabled
        if cache_config.get('enabled', False):
            cache_file = cache_config.get('file_path', '.tools_cache.json')
            try:
                # Serialize tools to JSON 
                # Note: Tool objects might need manual serialization if not dicts
                tools_data = [
                    {
                        "name": tool.name, 
                        "description": tool.description,
                        "inputSchema": tool.inputSchema
                    } for tool in self.tools_cache
                ]
                with open(cache_file, 'w') as f:
                    json.dump(tools_data, f)
            except Exception as e:
                logger.warning(f"Failed to save cache: {e}")

        logger.info(f"Cached {len(self.tools_cache)} tools")
        return self.tools_cache

    async def get_tool(self, tool_name: str) -> Optional[Any]:
        """Get details of a specific tool."""
        tools = await self.list_tools()
        for tool in tools:
            if tool.name == tool_name:
                return tool
        return None

    async def call_tool(self, tool_name: str, arguments: dict = None) -> Any:
        """Call a tool on the upstream server."""
        await self.ensure_connected()
        logger.info(f"Calling tool: {tool_name}")
        return await self.session.call_tool(tool_name, arguments or {})


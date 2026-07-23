import asyncio
import json
import logging
import os
import re
import yaml
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Matches basic-auth credentials embedded in a URL (user:pass@host) so we can
# redact them before logging the connection command.
_CREDENTIALS_RE = re.compile(r"://[^/@\s]+:[^/@\s]+@")


def _redact_credentials(text: str) -> str:
    """Replace `user:pass@` in any URL with `***@` for safe logging."""
    return _CREDENTIALS_RE.sub("://***@", text)

# Timeouts
INITIALIZE_TIMEOUT = 10.0  # Increased from 3.0 to handle remote Drupal latency
COMMAND_TIMEOUT = 60.0    # Increased from 30.0 for large toolsets (97+ tools)

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
            config = yaml.safe_load(f)

        # Expand ${ENV_VAR} references so secrets (e.g. the Drupal URL with its
        # credentials) live in the environment, not in the tracked config file.
        server_config = config.get('mcp_server', {})
        if isinstance(server_config.get('command'), str):
            server_config['command'] = os.path.expandvars(server_config['command'])
        if isinstance(server_config.get('args'), list):
            server_config['args'] = [
                os.path.expandvars(a) if isinstance(a, str) else a
                for a in server_config['args']
            ]
        return config

    async def connect(self):
        """Establish connection to the upstream MCP server."""
        server_config = self.config['mcp_server']
        server_params = StdioServerParameters(
            command=server_config['command'],
            args=server_config['args'],
            env={**os.environ, **server_config.get('env', {})}
        )

        log_msg = _redact_credentials(
            f"Connecting to Drupal MCP: {server_config['command']} {' '.join(server_config['args'])}"
        )
        logger.info(log_msg)
        self._log_to_file(log_msg)
        
        try:
            self._stdio_ctx = stdio_client(server_params)
            self.read_stream, self.write_stream = await asyncio.wait_for(
                self._stdio_ctx.__aenter__(), 
                timeout=5.0
            )
            
            self.session = ClientSession(self.read_stream, self.write_stream)
            await asyncio.wait_for(self.session.__aenter__(), timeout=2.0)
            
            # Initialize with timeout to prevent hanging the proxy
            await asyncio.wait_for(self.session.initialize(), timeout=INITIALIZE_TIMEOUT)
            logger.info("Connected and initialized with Drupal MCP")
            self._log_to_file("Connected and initialized with Drupal MCP")
        except asyncio.TimeoutError:
            error_msg = "Timeout while connecting to Drupal MCP server"
            logger.error(error_msg)
            self._log_to_file(f"ERROR: {error_msg}")
            await self.close()
            raise ConnectionError(error_msg)
        except Exception as e:
            error_msg = f"Failed to connect to Drupal MCP: {str(e)}"
            logger.error(error_msg)
            self._log_to_file(f"ERROR: {error_msg}")
            await self.close()
            raise

    def _log_to_file(self, message: str):
        """Helper to log to a file since stderr might be swallowed by some hosts."""
        try:
            log_file = "/tmp/drupal_proxy_debug.log"
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(log_file, "a") as f:
                f.write(f"[{timestamp}] {message}\n")
        except:
            pass

    async def close(self):
        try:
            if self.session:
                await self.session.__aexit__(None, None, None)
        except:
            pass
        finally:
            self.session = None
            
        try:
            if hasattr(self, '_stdio_ctx'):
                await self._stdio_ctx.__aexit__(None, None, None)
        except:
            pass

    async def ensure_connected(self):
        if not self.session:
            await self.connect()

    async def list_tools(self, force_refresh: bool = False) -> List[Any]:
        """List all tools available in Drupal, with caching."""
        try:
            await self.ensure_connected()
        except Exception as e:
            logger.error(f"Cannot list tools: connection failed: {e}")
            # If we have cache, use it as fallback even if connection failed
            if self.tools_cache:
                logger.warning("Using cache due to connection failure")
                return self.tools_cache
            raise

        cache_config = self.config.get('cache', {})
        ttl = cache_config.get('ttl_seconds', 3600)
        cache_file = cache_config.get('file_path', '.tools_cache.json')
        
        now = datetime.now()
        
        # Try to load from file if memory cache is empty
        if not self.tools_cache and cache_config.get('enabled', False):
            # (Keep existing cache loading logic)
            if os.path.exists(cache_file):
                try:
                    with open(cache_file, 'r') as f:
                        data = json.load(f)
                        self.tools_cache = data
                        mtime = os.path.getmtime(cache_file)
                        self.cache_last_updated = datetime.fromtimestamp(mtime)
                        logger.info(f"Loaded {len(self.tools_cache)} tools from file cache")
                except Exception as e:
                    logger.warning(f"Failed to load cache from file: {e}")

        if not force_refresh and self.tools_cache and self.cache_last_updated:
            seconds_since_update = (now - self.cache_last_updated).total_seconds()
            if seconds_since_update < ttl:
                logger.info("Using fresh cached tools list")
                return self.tools_cache
            else:
                logger.info(f"Cache expired ({int(seconds_since_update)}s > {ttl}s). Returning stale cache and refreshing in background.")
                asyncio.create_task(self._fetch_and_cache_tools())
                return self.tools_cache

        return await self._fetch_and_cache_tools()

    async def _fetch_and_cache_tools(self) -> List[Any]:
        """Internal method to fetch tools and update cache without blocking if stale data is available."""
        if not self.session:
            logger.error("Cannot fetch tools: no active session")
            return self.tools_cache or []

        now = datetime.now()
        cache_config = self.config.get('cache', {})
        cache_file = cache_config.get('file_path', '.tools_cache.json')

        logger.info(f"Fetching tools from Drupal MCP (timeout={COMMAND_TIMEOUT}s)...")
        try:
            # Use a timeout for fetching tools to avoid hanging forever
            result = await asyncio.wait_for(self.session.list_tools(), timeout=COMMAND_TIMEOUT)
            self.tools_cache = result.tools
            self.cache_last_updated = now
            
            # Save cache to file if enabled
            if cache_config.get('enabled', False):
                try:
                    tools_data = [
                        {
                            "name": tool.name, 
                            "description": tool.description,
                            "inputSchema": tool.inputSchema
                        } for tool in self.tools_cache
                    ]
                    with open(cache_file, 'w') as f:
                        json.dump(tools_data, f)
                    logger.info(f"Saved {len(tools_data)} tools to file cache")
                except Exception as e:
                    logger.warning(f"Failed to save tools cache: {e}")
            return self.tools_cache
        except Exception as e:
            logger.error(f"Failed to fetch tools from Drupal MCP: {e}")
            return self.tools_cache or []

    async def get_tool(self, tool_name: str) -> Optional[Any]:
        """Get details of a specific tool."""
        try:
            tools = await self.list_tools()
            for tool in tools:
                # Handle both object and dict
                name = tool.name if hasattr(tool, 'name') else tool.get('name')
                if name == tool_name:
                    return tool
        except Exception as e:
            logger.error(f"Error getting tool {tool_name}: {e}")
        return None

    async def call_tool(self, tool_name: str, arguments: dict = None) -> Any:
        """Call a tool on the upstream server."""
        await self.ensure_connected()
        logger.info(f"Calling tool: {tool_name}")
        # Add a reasonable timeout for tool execution too
        return await asyncio.wait_for(
            self.session.call_tool(tool_name, arguments or {}),
            timeout=60.0
        )


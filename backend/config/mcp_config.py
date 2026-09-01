# backend/config/mcp_config.py

from typing import Any

# Available MCP servers (docker exec into containers with a fixed name).
# n8n removed (the user no longer uses it). With no servers configured,
# MultiServerMCPClient does not try to connect to anything at startup.
MCP_SERVERS: dict[str, Any] = {}

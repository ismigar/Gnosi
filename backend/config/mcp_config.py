# backend/config/mcp_config.py

from typing import Any

# Available MCP servers (docker exec into containers with a fixed name).
# n8n removed (the user no longer uses it). With no servers configured,
# MultiServerMCPClient does not try to connect to anything at startup.
MCP_SERVERS: dict[str, Any] = {}

# Host-owned capability policy keyed by exact (server name, MCP tool name).
# Server annotations are descriptive hints, never authorization. Entries must
# declare effects, minimum_role and confirmation; unknown tools stay unavailable.
# Example: {("mail", "create_draft"): {"effects": ["external_write"],
#           "minimum_role": "editor", "confirmation": "always"}}
MCP_TOOL_POLICIES: dict[tuple[str, str], dict[str, Any]] = {}

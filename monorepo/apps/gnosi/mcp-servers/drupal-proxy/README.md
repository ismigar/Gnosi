# Drupal MCP proxy

An intermediate MCP proxy that makes the Drupal MCP server easier to use with
LLMs.

## Problem

The upstream Drupal MCP server exposes more than 97 tools. This consumes a
large part of the model context and makes it difficult to combine with other
MCP servers.

## Solution

The proxy connects to the upstream Drupal MCP server and exposes a small set
of meta-tools for discovering and invoking the underlying tools on demand.

## Exposed tools

1. `drupal_search_tools`: fuzzy search by tool name or description.
2. `drupal_execute_tool`: invoke a Drupal tool by name and arguments.
3. `drupal_list_categories`: list available tool groups.
4. `drupal_get_tool_schema`: return a tool's `inputSchema`.

## Configuration

### MCP client

Configure the proxy in an MCP client such as Claude Desktop through
`claude_desktop_config.json` or `mcp_config.json`.

On macOS, use the included `start_server.sh` because GUI-launched clients can
have a restricted `PATH`, especially for Homebrew installations of `uv` and
Docker.

```json
{
  "mcpServers": {
    "drupal-proxy": {
      "command": "/bin/sh",
      "args": ["-c", "exec $HOME/Projectes/monorepo/apps/gnosi/mcp-servers/drupal-proxy/start_server.sh"],
      "env": {}
    }
  }
}
```

MCP clients execute `command` without a shell, so `~` and `$HOME` are not
expanded when used directly. Wrapping the command with `/bin/sh -c` resolves
`$HOME` per machine without hard-coding a username.

### `config.yaml`

Set the command that starts the upstream Drupal MCP server, for example a
`docker exec ...` command.

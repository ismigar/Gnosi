# backend/config/mcp_config.py

# Definim els servidors disponibles i com connectar-s'hi.
# En aquest cas, utilitzem 'docker exec' per connectar amb els contenidors que ja corren.
# Important: Els contenidors han de tenir noms fixos (ex: notion-mcp, n8n-mcp).

MCP_SERVERS = {
    "notion": {
        "command": "docker",
        "args": ["exec", "-i", "notion-mcp", "node", "index.js"],
        "description": "Access to Notion workspace (Search, Read, Write pages/databases)."
    },
    "n8n": {
        "command": "docker",
        "args": ["exec", "-i", "n8n-mcp", "node", "index.js"],
        "description": "Access to n8n workflows (List, Execute, Get Status)."
    }
}

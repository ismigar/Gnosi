# backend/config/mcp_config.py

# Servidors MCP disponibles (docker exec a contenidors amb nom fix).
# n8n eliminat (l'usuari ja no l'utilitza). Sense servidors configurats,
# MultiServerMCPClient no intenta connectar a res a l'arrencada.
MCP_SERVERS: dict = {}

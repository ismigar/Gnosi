# Drupal MCP Proxy

Este es un servidor proxy MCP intermedio diseñado para optimizar la interacción con el servidor MCP de Drupal.

## Problema
El servidor MCP original de Drupal expone todas las herramientas disponibles (97+), lo que satura el contexto de los LLMs y hace difícil su uso junto con otros servidores MCP.

## Solución
Este proxy se conecta al servidor Drupal MCP original y expone solo un conjunto reducido de "meta-herramientas" que permiten descubrir y ejecutar las herramientas subyacentes bajo demanda.

## Herramientas Expuestas
1. **`drupal_search_tools`**: Busca herramientas disponibles por nombre o descripción (búsqueda fuzzy).
2. **`drupal_execute_tool`**: Ejecuta una herramienta específica de Drupal dado su nombre y argumentos.
3. **`drupal_list_categories`**: Muestra las categorías o grupos de herramientas disponibles.
4. **`drupal_get_tool_schema`**: Obtiene el esquema de entrada (inputSchema) de una herramienta específica para saber qué argumentos requiere.

## Configuración

### Cliente MCP (e.g., Claude Desktop)

Para usar este servidor, debes configurarlo en tu cliente MCP (por ejemplo, en `claude_desktop_config.json` o `mcp_config.json`).

**Importante**: Debido a problemas con el PATH en entornos macOS (especialmente con `uv` y `docker` instalados vía Homebrew), se recomienda usar el script `start_server.sh` incluido.

Ejemplo de configuración:

```json
{
  "mcpServers": {
    "drupal-proxy": {
      "command": "/Users/ismaelgarciafernandez/Projectes/monorepo/apps/digital-brain/mcp-servers/drupal-proxy/start_server.sh",
      "args": [],
      "env": {}
    }
  }
}
```

### config.yaml

Edita `config.yaml` para apuntar al comando correcto que inicia el servidor MCP de Drupal original (ej. `docker exec ...`).

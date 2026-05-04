# Parches para Módulos Contrib de Drupal

Este directorio contiene parches que deben aplicarse a módulos contrib de Drupal para corregir bugs o añadir funcionalidades necesarias.

## Uso con Composer Patches

### 1. Instalar el plugin
```bash
composer require cweagans/composer-patches
```

### 2. Configurar en composer.json
Añadir en la sección `extra`:
```json
{
  "extra": {
    "patches": {
      "drupal/mcp": {
        "Fix empty inputSchema validation": "patches/mcp-toolslist-inputschema-fix.patch"
      }
    }
  }
}
```

### 3. Aplicar parches
```bash
composer install
```

---

## Parches Disponibles

### mcp-toolslist-inputschema-fix.patch
- **Módulo**: `drupal/mcp`
- **Archivo**: `src/Plugin/McpJsonRpc/ToolsList.php`
- **Problema**: Plugins con `inputSchema` vacío (stdClass) causan error de validación JSON Schema.
- **Solución**: Normaliza `inputSchema` para asegurar `'type' => 'object'`.
- **Fecha**: 2026-01-22

# Patches for Drupal contributed modules

This directory contains patches applied to Drupal contributed modules to fix
defects or add required behavior.

## Composer Patches usage

### 1. Install the plugin

```bash
composer require cweagans/composer-patches
```

### 2. Configure `composer.json`

Add this under `extra`:

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

### 3. Apply patches

```bash
composer install
```

## Available patches

### `mcp-toolslist-inputschema-fix.patch`

- **Module**: `drupal/mcp`
- **File**: `src/Plugin/McpJsonRpc/ToolsList.php`
- **Problem**: plugins with an empty `inputSchema` (`stdClass`) fail JSON
  Schema validation.
- **Solution**: normalize `inputSchema` to guarantee `'type' => 'object'`.
- **Date**: 2026-01-22

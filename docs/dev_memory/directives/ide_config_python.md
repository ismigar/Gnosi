# DIRECTIVE: IDE_CONFIGURATION_PROTOCOL

> ID: 2026-02-26
Associated Script: N/A Last Update: 2026-02-26
Status: ACTIVE

---

## 1. Objectives and Scope

Mantener una configuración de VS Code coherente y funcional para el monorepo, asegurando que los intérpretes de Python y PHP sean correctamente detectados y utilizados por las extensiones correspondientes.

- **Main Objective:** Resolver errores de "Could not resolve interpreter path" y asegurar el correcto funcionamiento de Intelephense y Pylance.
- **Success Criteria:** Eliminación de advertencias en el IDE y funcionalidad completa de autocompletado/linting.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Ficheros de Configuración:** `.vscode/settings.json`.
- **Rutas Esperadas:**
    - Python: `${workspaceFolder}/monorepo/apps/digital-brain/.venv/bin/python` (v3.11+ recomendado)
    - PHP: `/opt/homebrew/opt/php@8.1/bin/php` (v8.1.0+ requerido para soporte `readonly`)

## 3. Configuration Steps

### Python
1. Recrear venv si es necesario: `rm -rf .venv && /opt/homebrew/bin/python3.11 -m venv .venv`.
2. Usar rutas relativas en `settings.json`.

### PHP
1. Asegurar que `php.executablePath` y `php.validate.executablePath` apuntan al binario correcto.
2. Configurar `intelephense.environment.phpVersion` a `8.1.0` o superior.

- **Symlinks:** Los entornos virtuales creados con el Python de macOS (CommandLineTools) pueden fallar si las herramientas se actualizan o se mueven. Es preferible usar versiones de Homebrew.
- **Multi-root:** Al trabajar con un monorepo, las rutas en `analysis.extraPaths` deben ser absolutas o usar `${workspaceFolder}` correctamente.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 26/02 | Could not resolve interpreter path | Symlink de .venv apuntando a CommandLineTools inestable o inaccesible. | Verificar existencia del binario y actualizar settings.json o recrear .venv. |
| 26/02 | Mensaje persistente de Pylance | Fijar explícitamente "Pylance" puede causar alertas falsas si la IDE no lo detecta de inicio. | Cambiar "python.languageServer" a "Default" para permitir gestión automática robusta. |
| 26/02 | Errores sintaxis PHP (readonly) | El validador nativo de VS Code o Intelephense desactualizado detectan erróneamente sintaxis 8.1+. | Forzar `intelephense.environment.phpVersion` a `8.1.0` y establecer `"php.validate.enable": false`. |

## 8. Pre-Execution Checklist
- [ ] Verificar versiones de Python instaladas (`brew list python` / `which python3`)
- [ ] Comprobar symlinks en `.venv/bin`

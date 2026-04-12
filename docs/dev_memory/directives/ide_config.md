# DIRECTIVE: IDE_CONFIGURATION_DIGITAL_BRAIN

> ID: 20260226_IDE_CONFIG
Associated Script: N/A Last Update: 2026-02-26
Status: ACTIVE

---

## 1. Objectives and Scope

Ensure a stable and deterministic development environment in VS Code/Cursor for the Gnosi monorepo.

- **Main Objective:** Maintain correct interpreter and analysis paths to avoid "Interpreter not resolved" errors.
- **Success Criteria:** No syntax or resolution errors in the IDE for Python and PHP files.

## 2. Input/Output (I/O) Specifications

### Configuration Files
- `.vscode/settings.json`: Main configuration file in the workspace root.

## 3. Logical Flow (Standard Configuration)

1. **Python Interpreter:** Always use the absolute path to the `.venv` inside the app folder if `${workspaceFolder}` fails.
2. **Analysis Paths:** Add `backend`, `pipeline/sandbox`, `pipeline/skills`, and `pipeline/private_skills` to `python.analysis.extraPaths`.
3. **PHP Version:** Set `intelephense.environment.phpVersion` to `8.1.0` for Drupal 10 compatibility.

## 5. Restrictions and Edge Cases

- **Variables:** VS Code variables like `${workspaceFolder}` might fail in some multi-root or complex workspace setups. Use absolute paths as a fallback.
- **PHP Path:** Ensure `php.executablePath` points to a version >= 8.1.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 26/02 | `${workspaceFolder}/monorepo/apps/gnosi/.venv/bin/python` could not be resolved | Variable resolution failure in specific IDE state | Use absolute path: `/Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi/.venv/bin/python` |
| 28/03 | `ERROR MCP: drupal-proxy: error: No such file or directory` | Incorrect path in `mcp_config.json` pointing to `gnosi` instead of `gnosi` | Updated `mcp_config.json` with correct path: `/Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi/mcp-servers/drupal-proxy` |

## 8. Pre-Execution Checklist

- [x] Verify `.venv` exists at the target path.
- [x] Test the absolute path by running `path/to/python --version`.

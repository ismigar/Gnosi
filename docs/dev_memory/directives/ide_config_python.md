# DIRECTIVE: IDE_CONFIGURATION_PROTOCOL

> ID: 2026-02-26
Associated Script: N/A Last Update: 2026-02-26
Status: ACTIVE

---

## 1. Objectives and Scope

Maintain a coherent, functional VS Code configuration for the monorepo so the
Python and PHP interpreters are detected and used correctly by their
extensions.

- **Main Objective:** Resolve "Could not resolve interpreter path" errors and
  ensure Intelephense and Pylance work correctly.
- **Success Criteria:** No IDE warnings and fully functional completion and
  linting.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Configuration Files:** `.vscode/settings.json`.
- **Expected Paths:**
    - Python: `${workspaceFolder}/monorepo/apps/gnosi/.venv/bin/python` (v3.11+
      recommended)
    - PHP: `/opt/homebrew/opt/php@8.1/bin/php` (v8.1.0+ required for `readonly`
      support)

## 3. Configuration Steps

### Python
1. Recreate the virtual environment if necessary: `rm -rf .venv &&
   /opt/homebrew/bin/python3.11 -m venv .venv`.
2. Use relative paths in `settings.json`.

### PHP
1. Ensure `php.executablePath` and `php.validate.executablePath` point to the
   correct binary.
2. Set `intelephense.environment.phpVersion` to `8.1.0` or newer.

- **Symlinks:** Virtual environments created with macOS Command Line Tools
  Python may fail when the tools are updated or moved. Prefer Homebrew
  versions.
- **Multi-root:** In a monorepo, paths in `analysis.extraPaths` must be absolute
  or use `${workspaceFolder}` correctly.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 26/02 | Could not resolve interpreter path | The `.venv` symlink points to an unstable or inaccessible Command Line Tools installation. | Verify that the binary exists and update `settings.json`, or recreate `.venv`. |
| 26/02 | Persistent Pylance message | Explicitly selecting "Pylance" can produce false warnings when the IDE does not detect it at startup. | Set `python.languageServer` to `Default` for robust automatic management. |
| 26/02 | PHP `readonly` syntax errors | The native VS Code validator or an outdated Intelephense incorrectly rejects PHP 8.1+ syntax. | Set `intelephense.environment.phpVersion` to `8.1.0` and `"php.validate.enable"` to `false`. |

## 8. Pre-Execution Checklist
- [ ] Check installed Python versions (`brew list python` / `which python3`).
- [ ] Check symlinks under `.venv/bin`.

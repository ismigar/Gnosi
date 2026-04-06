# Directive: Bulk API URL Refactoring

## Context
The Gnosi frontend currently contains multiple hardcoded references to `http://localhost:5002`. This causes several issues:
- **CORS Errors:** Requests bypass the Vite proxy.
- **Environment Incompatibility:** Deployment in Docker or different environments fails because the host might change.
- **Inconsistency:** Some parts use the proxy while others hit the backend port directly.

## Standard Operating Procedure (SOP)

### 1. Identify Target Patterns
- Search for `http://localhost:5002`.
- Search for `5002` in URL strings.

### 2. Replacement Rule
- All occurrences in React components (`.jsx`, `.js`) and utilities must be replaced by `/api`.
- For example: `axios.get('http://localhost:5002/api/vault/pages')` -> `axios.get('/api/vault/pages')`.
- **Note:** If the path already includes `/api`, ensure we don't duplicate it.

### 3. Execution via Sandbox Script
- Use a Python script to perform the replacement across the `src/` directory.
- Use `Pathlib` and `re` for safe replacement.
- Do not modify files outside of `monorepo/apps/gnosi/frontend/src/`.

### 4. Verification
- Run the app and verify `Network` tab in DevTools shows requests going to `http://localhost:5173/api/...` (proxied) instead of `5002`.

## Restrictions & Warnings
- **CAUTION:** Check if some files require a different backend host. For now, all should go through the Vite proxy.
- **WARNING:** Do not replace port `5002` in `vite.config.js` as it defines the proxy target.

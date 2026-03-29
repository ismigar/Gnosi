# Directive: Gnosi Settings and Internationalization (i18n)

## Context
Gnosi requires a robust way to manage user preferences (Language, Timezone, Currency, Week Start) and storage paths (Vault, Databases, Newsletters). These settings must be persistent across sessions and reflected in both Frontend and Backend.

## Storage Protocol

### 1. Persistence Layer
- All global settings and paths must be stored in `monorepo/apps/Gnosi/config/params.yaml`.
- The backend remains the source of truth for these configurations, exposed via `/api/config`.
- Avoid using `localStorage` for anything that needs to be shared with the backend or consistent across devices (except for UI-only transient states if strictly necessary).

### 2. Schema
Add a `settings` section to `params.yaml`:
```yaml
settings:
  language: "ca"          # ca, es, en, fr
  timezone: "Europe/Madrid" # IANA Timezone string
  currency: "EUR"         # ISO Currency code
  week_start: 1           # 0 (Sun) to 6 (Sat)
  use_system_defaults: true
paths:
  vault: "vault"          # Relative to PROJECT_DIR or absolute
  databases: "backend/data"
  newsletters: "backend/data/newsletters"
```

## i18n Protocol

### 1. Unified Interface
- All user-facing strings must be extracted to `frontend/src/locales/[lang]/translation.json`.
- Use the `useTranslation` hook from `react-i18next` in components.
- Avoid hardcoding strings in any language.

### 2. Language Detection
- On first load, if no language is set in `params.yaml`, fall back to system detection (`i18next-browser-languagedetector`).
- Once a user selects a language, save it to the backend.

## Path Management

### 1. Resolution
- Use `Path` from `pathlib` in Python to resolve paths.
- Paths in `params.yaml` can be relative (to `PROJECT_DIR`) or absolute.
- Always validate that the path exists and is writable before applying it in the UI.

### 2. Dynamic Loading
- Services (Graph, Vault, etc.) must read their paths from the `Config` object initialized from `params.yaml`.

## Constraints & Edge Cases
- **Invalid Paths**: If a configured path is invalid, fall back to the project default and log a warning.
- **Missing Translations**: If a key is missing in the target language, fall back to English (`en`).
- **Timezone mismatch**: Ensure the frontend uses the configured timezone for date display, not just the browser local time (if they differ).

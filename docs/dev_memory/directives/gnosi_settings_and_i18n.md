# Directive: Gnosi Settings and Internationalization

## Objective

Manage language, timezone, currency, week start, formatting, and storage paths
through one persistent configuration while keeping English as the deterministic
first-run language.

## Storage protocol

- The backend is the source of truth for shared settings and exposes them
  through `/api/config`.
- The tracked example lives at
  `monorepo/apps/gnosi/config/params.yaml.example`.
- The active values can come from the local base configuration, the active
  vault's `.gnosi/params.yaml`, or `~/.gnosi/params.yaml`; the precedence is
  implemented in `backend/config/app_config.py`.
- `localStorage` may hold the browser's explicit interface-language choice and
  other UI-only preferences. It must not store secrets or settings that backend
  services need.

Recommended settings shape:

```yaml
settings:
  language: en            # en, es, fr, ca
  timezone: UTC           # IANA timezone string
  currency: EUR           # ISO currency code
  week_start: 1           # 0 (Sunday) through 6 (Saturday)
  use_system_defaults: true
paths:
  vault: ~/Documents/Gnosi
  databases: ''
  newsletters: ''
```

## Language precedence

Resolve the interface language in this order:

1. A valid browser preference explicitly selected by the user.
2. A valid `settings.language` value returned by `/api/config`.
3. English (`en`).

Missing, blank, regional, or invalid values must be normalized. Supported
regional tags such as `en-GB` and `ca-AD` resolve to their base language;
unsupported values resolve to English.

Do not use browser or operating-system language detection as an implicit
first-run preference. It makes the initial interface depend on the machine
instead of the product default.

When the user selects a language, update the live i18n instance immediately,
persist the browser preference, and save the setting through the existing
configuration autosave.

## User-facing text

- Every React user-facing string must use `react-i18next`.
- Add each new key to
  `frontend/src/locales/{ca,en,es,fr}/translation.json` in the same change.
- English is the fallback catalog.
- Inline `defaultValue` text, when needed, must be English.
- Preserve language endonyms (`English`, `Español`, `Français`, `Català`).
- Do not translate persisted values, field identifiers, paths, or strings used
  for comparison.

## Collection editor interaction

- Forms that create or edit an item inside Settings must expand inline in the
  owning section. Do not open a second modal over the Settings modal.
- The section action changes from `Add …` to `Cancel` while the inline form is
  open. Cancelling discards the draft and restores the list.
- Place the explicit `Create …` or `Update …` action at the end of the form.
  Collection-item drafts are not autosaved because an incomplete draft is not
  yet an item.
- Existing-item configuration opens the same inline form populated with that
  item. Successful creation or update closes the form.
- Collection rows use the full section width and keep controls in the shared
  order: enable toggle, item identity, configure, then delete. Configure opens
  the inline editor; delete always asks for confirmation.
- Confirmation modals remain appropriate for destructive or irreversible
  actions; selectors such as the folder picker are not collection editors.

## Path management

- Resolve paths with `pathlib.Path`.
- Paths may be absolute or relative to the configured project/vault root.
- Validate existence and permissions before applying a path from the UI.
- Services must consume resolved paths from the active `Config` object.

## Edge cases

- Invalid paths fall back to the project default and produce an English
  developer warning.
- Do not enable unified autosave after only one Settings request completes:
  independent config, AI catalog, integration, and identity hydration can still
  be in flight, causing protected agents or persisted account data to be
  replaced by initial empty values. Gate autosave on all draft sources and use
  the first complete snapshot as the baseline. Ignore completions from stale
  hydration generations because React Strict Mode can start initialization
  twice during development.
- Missing translation keys fall back to English, but catalog parity must still
  be treated as required QA.
- Formatting may follow an explicit decimal/date setting independently of the
  interface language.
- Backend configuration may be unavailable before organization-mode login.
  The login screen remains English unless the browser already has an explicit
  language preference; the saved choice applies once configuration is
  available.

## Required validation

- Unit-test missing, invalid, regional, backend, and stored language values.
- Confirm a clean browser profile starts in English.
- Confirm selecting Catalan, Spanish, or French changes the interface
  immediately and survives reload.
- Confirm `/api/config` returns `settings.language: en` when the source value is
  missing or invalid.

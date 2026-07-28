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
- Cancelling an existing-item editor must also clear its identity state before
  the section action can open a create form. Otherwise the next `Add …` action
  can remount the stale existing-item editor instead of a blank draft.
- Place the explicit `Create …` or `Update …` action at the end of the form.
  Collection-item drafts are not autosaved because an incomplete draft is not
  yet an item.
- Existing-item configuration opens the same inline form populated with that
  item. Successful creation or update closes the form.
- Render an existing item's editor immediately after its owning row and before
  the next row. Use a keyed fragment or an equivalent row-plus-editor wrapper
  inside the collection map so DOM order always remains `item, editor, next
  item`.
- When an existing collection row remains visible as the identity header for
  its editor, visually join both surfaces: remove the inter-item gap, share the
  connecting border, and do not repeat a generic "Edit item" heading inside the
  form. Keep a descriptive heading for create-only forms, which have no owning
  row.
- Reuse the shared `settings-configurable-*` and `settings-inline-editor`
  classes for account integrations, vault calendars, reusable mail snippets,
  cognition agents, and other Settings collections. Configurable plugin cards
  may keep their panel inside the card, but the expanded card must use the same
  blue active border. Do not reintroduce per-collection inline geometry for
  borders, gaps, or connecting radii.
- Do not render one shared existing-item editor above or below the complete
  collection. The visual separation makes it unclear which item owns the draft,
  especially when the collection scrolls.
- A create-only form has no owning row and may remain at the section action or
  empty-state position. Components whose editable controls are already part of
  each row also satisfy this rule without a separate editor.
- Do not nest service-specific `<form>` elements inside a collection editor's
  submit form: React reports invalid HTML and browser submission behavior
  becomes ambiguous. Use styled `<div>` sections for IMAP, SMTP, or other field
  groups and keep one owning form with one submit action.
- Collection rows use the full section width and keep controls in the shared
  order: enable toggle, item identity, configure, then delete. Configure opens
  the inline editor; delete always asks for confirmation.
- Confirmation modals remain appropriate for destructive or irreversible
  actions; selectors such as the folder picker are not collection editors.

## AI Settings surface

- Keep the top-level AI tab focused on the model-comparison launcher and the
  cognition-agent collection. Provider credentials and model activation belong
  to the comparison workflow; do not restore a separate advanced-settings
  disclosure or a second manual model registry below the launcher.
- Agent icons are persisted values, not display text. Render emoji, images, and
  `lucide:IconName:color` values through the shared `IconRenderer`; never
  interpolate a Lucide descriptor directly into an agent row.
- The agent form shows one selected icon in a compact trigger. Clicking it opens
  a searchable icon grid; do not render the complete grid permanently beside
  the agent name.
- Agent Lucide choices use the corporate blue token and persist as
  `lucide:IconName:blue`. Keep a broad curated grid for browsing and expose the
  full Lucide registry through search.
- Do not handle a nested picker Escape key only at document or element level:
  `useModalKeyboard` captures the event on `window` first and the settings modal
  will close. Register the open picker through `useModalKeyboard` so it becomes
  the top modal layer and Escape closes only the picker.

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
- For every Settings collection editor, verify in the DOM and visually that the
  edited row is immediately followed by its editor and then by the next row.
- Confirm the AI tab has no advanced-settings disclosure and that every
  `lucide:` agent icon is rendered as an SVG instead of visible descriptor text.
- Confirm the agent icon trigger shows one icon while closed, opens and closes
  with pointer and keyboard interaction, and stores the selected blue icon.

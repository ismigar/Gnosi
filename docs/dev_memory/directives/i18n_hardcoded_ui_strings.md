# Directive: Localize Hardcoded User-Interface Text

## Objective

No user-visible React text may be hardcoded. Route every label, description,
placeholder, status, error, confirmation, tooltip, empty state, and accessible
name through `react-i18next`, with complete catalogs for English, Spanish,
French, and Catalan.

English is the first-run and fallback language. Users may explicitly select any
supported language.

Locale discovery is declarative: complete catalogues under
`frontend/src/locales/<bcp47>/translation.json` are registered automatically and
provide their own display and formatting metadata.

## Standard pattern

1. Choose a namespace that follows the existing screen/component hierarchy.
   Settings panels use `settings.<panel>.*`; shared UI uses `common.*`; feature
   areas use their established namespace.
2. Call `t('namespace.key')` or use a short namespaced helper when a component
   has many related keys.
3. Add the key to all four catalogs in the same change:
   `frontend/src/locales/{ca,en,es,fr}/translation.json`.
4. When an inline default is useful, write it in English and still add the key
   to every catalog. A default is not a substitute for catalog parity.
5. Preserve existing JSON formatting and create a minimal diff.

## Composition rules

- Use interpolation (`{{name}}`, `{{count}}`) instead of concatenating
  translated fragments.
- Use i18next plural variants (`_one`, `_other`) and pass `count`.
- Use `<Trans>` when a sentence contains links, emphasis, or embedded
  components. Do not split one grammatical sentence into unrelated keys.
- Format dates with the selected/resolved interface locale, falling back to
  English.
- Provide translated `aria-label`, `alt`, `title`, and placeholder text.

## Restrictions and edge cases

- Translate labels, not persisted values. Field names, enum values, table
  identifiers, view types, chart types, date format tokens, and strings used in
  comparisons must remain stable.
- A title written into a vault record is user data, not interface chrome. Keep
  persisted defaults stable unless a separate migration explicitly changes
  them.
- Technical backend detail may be appended to a localized generic error, but
  the user-facing framing must be translated.
- File syntax, Markdown fences, CSL data, prompt payloads, and schema values
  require case-by-case review; do not classify them as UI solely because they
  are string literals.
- Reusing an existing key can expose a catalog gap. Check all four catalogs,
  including plural variants.
- Language endonyms are intentionally literal.

## Detection

Use an AST-aware scan:

- `JSXText` nodes with meaningful text.
- Rendered string literals in JSX expressions.
- UI-bearing attributes such as `placeholder`, `title`, `alt`, `aria-label`,
  and `aria-description`.
- Toast, modal, and confirmation arguments.
- Arrays/objects whose labels or descriptions are rendered.

Exclude tests, localization catalogs, vendor code, generated assets, URLs,
identifiers, persisted data, and syntax literals. Accent-only searches miss
ASCII Catalan/Spanish and produce false positives from data; they are an
inventory aid, not a compliance gate.

Extract every static `t()` key and verify that it exists in all four catalogs.
Account for prefixed helpers (for example, a helper that expands
`accounts.title` to `settings.accounts.title`) and plural keys.

## Historical lessons

- A Catalan inline default once masked missing keys in every locale. Catalog
  presence is mandatory even when the fallback text appears correct.
- A naive JavaScript scanner confused regex literals and JSX apostrophes, then
  modified user-visible code. Use Espree or another real parser.
- Portal-based modals render under `document.body`; browser QA must inspect the
  body rather than only the React root.
- Reused keys had incomplete French coverage even though English fallback
  prevented raw-key rendering. Fallback behavior is not locale parity.

## Required validation

- Parse all four JSON catalogs and confirm referenced-key parity.
- Run the frontend unit tests, lint, and `npm run build`.
- In a clean browser profile, verify the startup screen is English and contains
  no raw keys or Catalan/Spanish leaks.
- Switch to Catalan, Spanish, and French and confirm the affected screen
  updates without reload.
- Reload after a non-English selection and confirm the explicit choice
  persists.

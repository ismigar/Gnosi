# Directive: English Default and Internationalization

> ID: 2026-03-31 · Last updated: 2026-07-24
>
> Companion directives: `english_code_documentation.md` (source documentation),
> `i18n_hardcoded_ui_strings.md` (user interface), and
> `gnosi_settings_and_i18n.md` (settings persistence).
>
> Status: **ACTIVE STANDARDIZATION AUDIT**. The 2026-07-11 pass covered most
> source comments and the main React interface, but it did not make English the
> deterministic first-run language and it did not cover every historical
> directive, auxiliary interface, developer log, or default parameter.

> **2026-07-24 — Declarative locale registry.** UI locales are discovered from
> `frontend/src/locales/<bcp47>/translation.json`; application code must not maintain a
> second supported-language list. Each catalogue declares `_meta.nativeName`,
> `_meta.intlLocale`, `_meta.direction`, and optionally `_meta.zoteroLocale`.

## Objective

Make English the common default and maintenance language throughout Gnosi while
preserving the user's explicit language choice.

- A new installation, browser profile, vault, or configuration with no language
  preference must start in English.
- An explicit user choice (`ca`, `en`, `es`, or `fr`) must persist and take
  precedence over the English default.
- Missing or invalid language values must resolve to English.
- Every user-facing string in the React application must use i18n, with complete
  `ca`, `en`, `es`, and `fr` catalog parity and English as the fallback catalog.
- Source comments, docstrings, JSDoc, developer logs, directives, and
  first-party documentation must be written in English.

This policy does not translate user data, test fixtures, persisted field names,
language endonyms, localization catalogs, prompt content whose language is part
of the feature, or external/vendor material.

## Authoritative scope

- Application: `monorepo/apps/gnosi/`
- Frontend initialization: `monorepo/apps/gnosi/frontend/src/i18n.js`
- Locale catalogs:
  `monorepo/apps/gnosi/frontend/src/locales/{ca,en,es,fr}/translation.json`
- Configuration defaults: `monorepo/apps/gnosi/config/`
- Directives and development memory: `docs/dev_memory/`
- First-party Markdown and text documentation under the application tree.

The removed root-level `apps/gnosi/` mirror is never a valid target.
`frontend/vendor/`, `node_modules/`, generated assets, and third-party code are
outside the translation scope.

## Language precedence

Resolve the interface language in this order:

1. A valid preference explicitly selected by the user and stored by the
   application.
2. A valid backend setting saved for that user or vault.
3. English (`en`).

Do not use the browser or operating-system locale as the implicit first-run
choice. System locale detection made the first screen Catalan or Spanish on
some machines even though `fallbackLng` was English. `fallbackLng` handles
missing translation keys; it does not select the initial language.

Changing the selector must update the live i18n instance immediately and
persist through the existing settings channel. Do not reset an already stored,
valid non-English choice during startup.

## Execution procedure

1. Inventory language defaults in frontend initialization, settings state,
   example configuration, backend service parameters, and auxiliary interfaces.
2. Inventory non-English source documentation and developer logs with a
   parser-aware audit; do not treat arbitrary string literals as comments.
3. Inventory first-party Markdown separately, excluding localization fixtures,
   generated output, vendor content, and examples that intentionally show
   another language.
4. Make English the explicit missing/invalid default at every language boundary.
5. Translate source documentation and developer diagnostics into concise,
   technical English without changing identifiers or behavior.
6. Move hardcoded React UI text behind `t()` and add every key to all four
   catalogs. Inline defaults, when retained, must be English.
7. Translate first-party directives and documentation while preserving code
   blocks, commands, paths, keys, links, and historical facts.
8. Re-run the audits, locale parity checks, tests, static build, and browser/E2E
   validation.

## Detection and verification

- Use `pipeline/scripts/scope_code_docs.py` as an inventory aid, not as a final
  pass/fail gate. Non-ASCII symbols such as arrows and proper names can be valid
  in English.
- Catalan elisions (`l'`, `d'`, `s'`, `n'` followed by a letter) and accented
  Catalan/Spanish words are strong signals, but parser context is required to
  distinguish documentation from user data.
- For Python, use `tokenize` and `ast` to identify comments and docstrings.
- For JavaScript and TypeScript, use a real parser such as Espree. Regex-based
  scanners can confuse regex literals, templates, and JSX apostrophes.
- Extract every static `t()` key and verify plural-aware parity in all four
  catalogs.
- Verify language resolution with unit tests for missing, invalid, English, and
  saved non-English preferences.

## Restrictions and edge cases

- Do not translate identifiers, routes, database columns, field names, paths,
  serialized enum values, or strings used for comparison.
- Do not translate user-authored vault content or test fixtures merely because
  they contain Catalan or Spanish.
- Do not translate localization catalog values into English. Those catalogs are
  the mechanism that preserves the user's language choice.
- Do not translate language endonyms such as `English`, `Español`, `Català`, and
  `Français`.
- Do not rewrite prompt templates when the target language is intentional
  product behavior. Change only an unintended default language parameter.
- Do not rely on a Catalan inline `defaultValue`. It hides missing catalog keys
  and leaks Catalan into every language when parity regresses.
- Do not use a broad text replacement on executable code. Translate only
  parser-identified documentation/log spans and verify that non-comment tokens
  are unchanged.
- Do not reserialize locale JSON wholesale. Preserve formatting and keep diffs
  reviewable.

## Required validation

- Language-resolution unit tests pass.
- Locale JSON parses and the four catalogs have parity for all referenced keys.
- Parser-aware source audit has no unexplained Catalan/Spanish documentation or
  developer-log findings.
- First-party documentation audit has no unexplained Catalan/Spanish prose.
- `npm run build` completes with zero errors.
- Relevant frontend and backend tests pass.
- Browser QA proves that a clean profile starts in English and that selecting at
  least one non-English language survives reload.
- E2E checks show no raw i18n keys and no unintended non-English first-run text.

## Lessons recorded

| Date | Finding | Rule |
| --- | --- | --- |
| 2026-07-10 | A naive JavaScript scanner spliced a translation into JSX user text. | Use a real parser and compare non-comment tokens. |
| 2026-07-11 | Catalog parity can regress when existing keys are reused. | Check all four locales, including plural variants. |
| 2026-07-24 | `fallbackLng: 'en'` did not prevent browser locale detection from selecting Catalan on first run. | Resolve missing preferences explicitly to `en`; do not use system locale as the first-run selector. |
| 2026-07-24 | The prior audit declared success while directives, logs, auxiliary UI, and service defaults remained non-English. | Keep a reproducible whole-scope audit and document intentional exceptions. |

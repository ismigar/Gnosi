# DIRECTIVE: LANGUAGE_STANDARDIZATION_AND_I18N

> ID: 2026-03-31 · Last Update: 2026-07-11
Companion directives: `english_code_documentation.md` (code→English) · `i18n_hardcoded_ui_strings.md` (UI→i18n)
Status: **ADOPTED — this is the standing rule for all new code.**

> **2026-07-11 — Codebase brought to standard and published.** Comments/docstrings/JSDoc and
> `console.*` logs translated to English across ~700 files; ~1,000 i18n keys added to the four
> locales (full parity) migrating hardcoded UI to `t()`; inline-default debt closed (every `t()`
> key present in `ca`). Verified: `npm run build` green, browser QA in ca/en/fr (no raw keys),
> `pytest` baseline unchanged; synced to public `Gnosi` via `sync.yml`. From now on this is
> maintenance: keep every new change compliant.

---

## 1. Objectives and Scope

Ensure the entire codebase follows a professional international standard while maintaining accessibility for the target audience.

- **Main Objective:** All technical documentation (comments, docstrings, JSDoc, developer logs) must be in English. All user-facing strings must be localized via react-i18next.
- **Success Criteria (all currently met — keep them true):**
    - No non-English comments/docstrings/`console.*` in `.py`, `.js`, `.ts`, `.jsx`, `.tsx` files.
    - No hardcoded Catalan/Spanish strings in the UI (every visible string via `t()`).
    - The four locale files (`ca`, `en`, `es`, `fr`) are synchronized: every `t()` key exists in `ca` (source) and ideally in all four; missing keys render the raw Catalan default in every language.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Source Files:** `monorepo/apps/gnosi/`
- **i18n Config:** `monorepo/apps/gnosi/frontend/src/i18n.js` and `locales/` directory.

### Outputs
- **Modified source files** with English comments and i18n keys.
- **Updated locale JSON files.**

## 3. Logical Flow (Algorithm)

1. **Discovery:** Run `scan_comments.py` to identify problematic lines.
2. **Review:** Categorize findings into "Internal" (Comments/Logs) and "External" (UI Strings).
3. **Internal Translation:** Convert Catalan/Spanish comments to English. Use professional/technical terminology.
4. **External Localization:** 
    - Create/Find keys in `translation.json`.
    - Replace hardcoded text in components with `t('key')`.
5. **Validation:** Check that the UI still works and shows the correct language based on settings.

## 4. Tools and Detection (updated 2026-07-11)

- **Frontend i18n:** `react-i18next`; locales in `frontend/src/locales/{ca,en,es,fr}/translation.json`
  (format: `json.dumps(indent=2, ensure_ascii=False)` + trailing newline — preserve it for minimal diffs).
- **Detecting non-English comments:** use `pipeline/scripts/scope_code_docs.py` (Python `tokenize`/`ast`
  + a JS/TS comment scanner) — it separates comments/docstrings from string literals. The single most
  reliable signal for Catalan is the **elision** `l'`/`d'`/`s'`/`n'` + letter (never English; but guard the
  English possessive/contraction false positives `field's`/`don't`). Accented *letters* are a signal;
  accented *symbols* (→ — ·) are not. Word-lists miss ASCII-only Catalan (`Coneixement`, `Corregeix`).
- **Detecting hardcoded UI + missing keys:** an `espree`-AST scan for JSXText / UI-attribute / toast literals
  finds hardcoded strings (accent-based scans MISS ASCII Catalan and strings inside rendered data arrays).
  For "keys that render raw", extract every `t('ns.key', 'default')` and check the key exists in `ca` — but
  account for **prefix helpers** (`tn('accounts.x')` → `t('settings.accounts.x')`) or you get false positives.
- **Verify only comments changed** (translation passes) with `tokenize`/`ast` (Python) and `espree.tokenize`
  (JS) token-diffs vs HEAD — do NOT trust a hand-rolled JS scanner (regex literals/JSX apostrophes fool it and
  can splice a translation into user-facing JSX text).
- **Merging keys into locales:** add nested keys idempotently (skip existing) and keep the exact formatting;
  never re-serialize with a formatter that rewrites every line.
- **Translation:** AI-assisted; always fill `ca` (source) + `en`/`es`/`fr`, preserving `{{interpolation}}`,
  `<Trans>` tags, and plural `_one`/`_other`.

## 5. Restrictions and Edge Cases
- **Keywords:** Do not translate variable names that might break logic, even if they are in Catalan (unless refactoring is safe and planned).
- **Paths:** Do not translate folder names that are part of the filesystem structure (e.g., `BD/`, `Vault/`).
- **Mixed Content:** Some strings might be stored in the database/files (Connector importació Notion content); these are NOT part of the i18n code standardization unless they are UI labels.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 31/03 | N/A | Initial Setup | Documenting patterns in `server.py` |

## 7. Examples of Use
- Use `t('common.save')` instead of `Guardar`.
- Use `# Configure paths` instead of `# Configurar rutes`.

## 8. Pre-Execution Checklist
- [ ] Backup current state of `locales/`.
- [ ] Verify `npm run dev` works before starting.

## 9. Post-Execution Checklist
- [ ] `npm run build` succeeds.
- [ ] No regression in UI text visibility.
- [ ] `scan_comments.py` returns 0 hits for target keywords.

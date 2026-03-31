# DIRECTIVE: LANGUAGE_STANDARDIZATION_AND_I18N

> ID: 2026-03-31
Associated Script: pipeline/sandbox/scan_comments.py Last Update: 2026-03-31
Status: DRAFT

---

## 1. Objectives and Scope

Ensure the entire codebase follows a professional international standard while maintaining accessibility for the target audience.

- **Main Objective:** All technical documentation (comments, logs, variable names) must be in English. All user-facing strings must be localized via an i18n system.
- **Success Criteria:** 
    - No non-English comments in `.py`, `.js`, `.ts`, `.jsx`, `.tsx` files.
    - No hardcoded Catalan/Spanish strings in the UI.
    - Existing i18n files (`en`, `es`, `ca`) are synchronized and complete.

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

## 4. Tools and Libraries
- **Backend:** Python `re`, `json`.
- **Frontend:** `react-i18next`.
- **Translation:** AI-assisted translation for comments.

## 5. Restrictions and Edge Cases
- **Keywords:** Do not translate variable names that might break logic, even if they are in Catalan (unless refactoring is safe and planned).
- **Paths:** Do not translate folder names that are part of the filesystem structure (e.g., `BD/`, `Vault/`).
- **Mixed Content:** Some strings might be stored in the database/files (Notion content); these are NOT part of the i18n code standardization unless they are UI labels.

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

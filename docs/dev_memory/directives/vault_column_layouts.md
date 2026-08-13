# Vault column layouts

## Objective

Expose column layouts with two through five columns in the Vault editor Slash
menu. The same layouts must work at the page root and inside structural
containers such as callouts.

## Architecture

- `frontend/src/components/Vault/slashMenuUtils.js` owns the custom column
  layout catalog.
- Each layout inserts one `columnList` block containing the requested number of
  `column` children.
- Every new column starts with an empty paragraph so the text cursor can enter
  it immediately.
- `BlockEditor.jsx` supplies the visual icon and renders the catalog returned by
  the utility; it must not duplicate the supported layout counts.
- User-facing layout names live under `editor.column_layout_N` in all four
  locale files.

## Restrictions and edge cases

- Do not cap the Slash menu at three columns: the BlockNote multi-column schema
  accepts more children and a catalog-only cap hides supported layouts.
- Do not create a separate block type for four or five columns: all layouts use
  the canonical `columnList` and `column` structure so Markdown persistence and
  nesting continue to work unchanged.
- Keep the supported range explicit at two through five columns. A single
  column is a paragraph flow, while more than five columns is not offered
  because the content becomes impractical at the editor's supported widths.
- Keep translations complete for Catalan, English, Spanish, and French; a
  missing key would expose fallback text in localized menus.

## Verification

1. Unit-test that the catalog exposes 2, 3, 4, and 5 columns.
2. Execute the five-column action and verify one `columnList` with five
   editable `column` children is inserted.
3. Run focused lint, Vitest, the production frontend build, and the engineering
   documentation gate.
4. In the native browser UI, type `/column` inside a callout, confirm all four
   choices appear, insert five columns, save, reload, and confirm five columns
   remain inside the callout.

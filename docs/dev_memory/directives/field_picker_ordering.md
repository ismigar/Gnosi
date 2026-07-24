# Directive: Alphabetical Field Pickers

## Objective

Make every field-selection control predictable by ordering its field labels
alphabetically in the current interface locale.

## Rules

- Apply alphabetical ordering to fields rendered as native select options,
  checkbox groups, pills, radio groups, and other pickers.
- Sort by the visible label, case- and accent-insensitively. Keep sentinel
  options such as empty, automatic, or none before the field options.
- Use `frontend/src/utils/fieldOrdering.js`; do not mutate API or persisted
  schema arrays with an in-place `sort()`.
- Apply the same ordering to source-field mapping controls and plugin settings.
- Do not reorder views whose order is itself user data: schema drag-and-drop,
  saved visible-column order, mail field layout, and explicit sort priority.

## Validation

- Verify controls with accented names and mixed case.
- Confirm special first options remain first and selected values do not change.
- Run the frontend i18n validation and production build.

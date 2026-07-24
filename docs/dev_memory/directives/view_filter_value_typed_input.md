# Directive: Type-aware view-filter values

## Objective

In the database View Editor's Filters tab, the value control must match the
selected field type. A boolean field such as Archive must not show an
unconstrained text input.

## Scope

Change the value control only, not the operator list:

- `checkbox`: render a checkbox that emits `"true"` or `"false"`. Default to
  `"false"` rather than empty so boolean comparison includes unset values.
- `number`: use `<input type="number">`.
- `date`/`datetime`: use date or `datetime-local`.
- `relation`: use the existing `RelationValuePicker`.
- `text`, `status`, `select`, `multi_select`, `url`, `period`, and remaining
  types: keep text input until their option data is available.

## Restrictions and edge cases

- `/api/vault/registry` currently returns `options: null` for select-like
  fields. A dropdown would require the option-loading behavior used by
  `/api/graph`. Keep text inputs rather than showing empty dropdowns.
- Checkbox values are stored as booleans, and unchecked fields are often
  absent rather than explicit `false`.
- Both filtering engines must handle booleans identically:
  `utils/vaultFilters.js::matchesFilters` in the live frontend and
  `services/view_snapshot.py::apply_filter` in backend snapshots.
- When the filter value is exactly `"true"` or `"false"`, `equals` and
  `not_equals` use boolean coercion compatible with
  `rule_engine._is_truthy_checkbox`. Unset, zero, and false are unchecked;
  configured truthy aliases remain compatibility data.

## QA

- Frontend build succeeds.
- `equals true` shows checked rows only.
- `equals false` shows unchecked and unset rows.
- Verify interactively with a checkbox field in the Areas table.

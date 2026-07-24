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
- `date`/`datetime`/`period`: use a calendar input (`date` or `datetime-local`).
- `relation`: use the existing `RelationValuePicker`.
- `select` and `status`: render a native selector from the field option catalog.
- `multi_select`: render a multiple selector from the field option catalog; a
  record matches when it has any selected option.
- `text`, `url`, and remaining types: keep text input.

## Restrictions and edge cases

- Select-like properties may expose options at either `property.options` or
  `property.config.options`; preserve both when mapping table properties into
  the modal. If a legacy field has no catalog options, retain the text input
  so the existing saved filters stay editable.
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

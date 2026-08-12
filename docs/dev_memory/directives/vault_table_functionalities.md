# Vault Table Functionalities

## Objective

Move row actions out of schema properties. Users configure reusable table
functionalities in Table configuration, enable them independently, and invoke
enabled functionalities from the fixed row-action column at the left of a
table.

## Data model

- Table-level `functionalities` is an ordered array.
- Each entry has a stable `id`, `enabled`, `label`, `action`, and `config`.
- Supported actions reuse the existing button-action engine:
  `translate_row`, `set_fields`, `ai_prompt`, and `run_skill`.
- Labels are user-authored persisted data and are not translated. Editor chrome,
  action names, hints, errors, and accessible labels use i18n.
- A functionality is presentation-independent table metadata. Views decide how
  rows are displayed but do not own or duplicate functionality definitions.

## Legacy migration

- The `button` property type is no longer offered by the schema editor.
- On opening Table configuration, legacy button properties are converted in
  memory to table functionalities while preserving their label, action,
  configuration, and order.
- A functionality already persisted with the same legacy field identifier wins
  over the derived legacy entry, so repeated saves are idempotent.
- Saving removes legacy button properties from the schema and persists their
  converted functionality definitions on the table.
- Until a table is saved, table rendering derives legacy button properties as
  fallback functionalities and excludes them from data columns. This avoids a
  temporary regression or duplicated action during gradual migration.

## Interaction contract

- Table configuration contains a Functionalities subsection with add, remove,
  enable/disable, label, action, and action-specific configuration controls.
- Only enabled functionalities appear in the left row-action column.
- The button tooltip uses the configured label; compact icons preserve the
  existing table geometry.
- Translation, field assignment, AI prompt, and Skill execution reuse their
  existing validation, loading, toast, refresh, and modal flows.
- Built-in Open, Translate, Drupal, social publishing, resource, and plugin
  actions continue to work and remain ordered consistently.

## Restrictions and edge cases

- Do not store functionalities as view configuration; that would make actions
  disappear or diverge when switching views.
- Do not wire functionalities only through the standalone table route. The
  table-tab renderer, split-pane renderer, and embedded-view renderer must all
  pass the table-level definitions to `VaultViewBody`.
- Do not keep a legacy button property visible as a data column; it has no row
  value and duplicates the fixed action control.
- Do not delete a legacy definition before deriving its table functionality;
  that would lose user-authored labels, prompts, assignments, or Skill IDs.
- Do not execute disabled functionalities, even if stale UI state exposes an
  old handler.
- Do not render the built-in translation action alongside an enabled
  `translate_row` functionality; one configured action must produce one row
  button.
- Do not combine native `title` tooltips with the custom `row-action-tooltip`;
  keep the accessible `aria-label` and render only one visual tooltip.
- Do not use a one-shot “skip next autosave” flag. It can discard a fast first
  interaction, while removing the guard can persist the initial empty React
  state and delete schema-owned asset folders. Gate autosave on an explicit
  initialized-state flag that becomes true in the same state batch as the
  hydrated fields and functionalities.
- Do not recursively delete a property asset folder because a full-table schema
  payload omits that property. A client hydration race can produce a transient
  empty schema and destroy user attachments. Schema reconciliation may remove
  only an empty property folder; preserve non-empty folders for explicit,
  separately authorized cleanup.
- Do not translate functionality labels because they are persisted user data.
- Keep unknown configuration keys during round trips for forward compatibility.

## QA gates

1. Frontend lint, unit tests, and production build pass.
2. Backend action tests still pass for the reused execution endpoints.
3. Browser QA confirms `Button` is absent from property types.
4. Browser QA adds and configures a functionality, enables it, and confirms its
   action button appears in the left row-action column.
5. Browser QA disables the functionality and confirms the row button disappears.
6. A legacy button property is represented once as a functionality, omitted
   from data columns, and removed from the saved schema without losing config.

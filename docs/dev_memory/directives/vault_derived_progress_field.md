# Directive: Derived project Progress field

## Objective

Convert the Projects table Progress field (`fld_ba83d2a5`) from a manually
stored 0–1 number to a read-only derived percentage of related Tasks whose
Status is the configured done value. Calculate it on read so it remains fresh
across tables, embedded views, and Drupal synchronization.

## Architecture

Use virtual fields in `backend/api/virtual_fields.py`, whose
`inject_for_table` path already runs from table endpoints.

This choice does not make `rule_engine` rollups dead code; they are active for
materialized derived values. Progress specifically needs read-time calculation
because its inverse relation is authoritative and its value must never be
stored in page Markdown.

Formula:

`Progress = round(done related tasks / total related tasks × 100)`

Return empty when the project has no related tasks.

## Restrictions

- The relation is inverse: Project rows can have an empty Tasks field. Scan
  Task pages and group their Project field rather than reading
  `Projects.Tasks`.
- The backend strips wikilinks, so `metadata["Project"]` contains clean IDs.
  Retain title fallback for manually authored Obsidian links.
- Count only values equal to `config.done_value`. Existing localized status
  values are persisted user data and remain supported.
- Use a 0–100 scale because percent formatting displays the value directly
  rather than multiplying by 100.
- In `save_page_md`, remove every `type: "virtual"` field after
  `to_storage_names` and before writing. Do not change `to_storage_names`
  because response conversion still needs virtual values.
- `inject_for_*` requires a `page_loader` because the wikilink graph lacks
  task Status. Without a provider, return an empty field safely.
- Memoize the progress index by `_page_index_version` to avoid recomputing for
  every page during `refresh_view_snapshots`.
- Include `virtual` in frontend `isComputedType`, and apply numeric `format`
  in `renderCellContent` without changing boolean virtual fields.

## Registry conversion

`PATCH /properties/{id}` does not cover top-level `compute` and `format`.
Back up and edit `BD/vault_db_registry.json`, then restart the native backend.
Follow the existing Centrality virtual-field shape.

## QA

- Table API returns values from 0 through 100 and empty for projects without
  tasks.
- The table renders a read-only percentage and can sort and filter it.
- Embedded views and Drupal sync receive the value.
- Saving a project does not write Progress into Markdown.
- Frontend build and lint pass.

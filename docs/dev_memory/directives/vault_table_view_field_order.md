# Directive: Canonical Vault table and view field order

## Objective

Keep every Vault table schema and all of its views aligned to one predictable
field order. The title field is first, creation and modification timestamps are
last, and functional fields keep a stable semantic sequence between them.

## Protocol

1. Read the active `vault_db_registry.json` through the configured native Vault
   path and abort if the registry is missing, unreadable, or structurally
   invalid.
2. Inventory every table, its ordered `properties`, registry views, and embedded
   page sections before proposing changes.
3. Build one canonical order per table. Put the property whose type is `title`
   first. Keep functional properties in an explicitly reviewed logical order.
   Put `created_time` immediately before `last_edited_time` at the end.
4. Apply the canonical order to the table's `properties` array.
   Increment `schema_revision` when that ordered array changes so an already
   open schema editor cannot later restore the stale order.
5. Reorder each view reference list (`visibleProperties`,
   `visible_properties`, or `columns`) by the canonical table order while
   preserving the view's visible-field subset and descriptor-object shape.
6. Apply the same rule to page-embedded sections that use the table as their
   source. Multi-table views use the base table order first and then joined-table
   fields in join order, each following its own canonical order.
7. Produce a dry-run report, then create a timestamped backup beside the
   registry and write the updated JSON atomically. Re-read and validate the
   written file before reporting success.

## Restrictions and edge cases

- Do not alphabetize schema fields: field order is user data and must be
  semantically reviewed.
- Do not add hidden fields to a view or remove visible fields merely to align
  order. Alignment means identical relative order for the fields that each view
  displays.
- Do not identify system dates only by their localized labels. Prefer the
  canonical `created_time` and `last_edited_time` types, using known legacy
  labels only as a guarded fallback.
- Do not replace descriptor objects with strings. Resolve their `fieldKey` for
  ordering and preserve every other descriptor member.
- Do not mutate filters, sorts, grouping, formulas, relations, joins, or record
  frontmatter during an order-only migration.
- Do not bypass schema revision reconciliation. An order-only registry script
  must bump `schema_revision` for every changed table, because a stale browser
  snapshot otherwise remains eligible to overwrite the new order.
- Do not write when a view references an unknown field without recording it in
  the report. Keep unknown references stable after known functional fields and
  before system dates.
- Do not write directly to a cloud-synced registry without a side-by-side
  backup and an atomic replacement, because a partial JSON file can propagate
  to other devices.

## Validation

1. Every table with a title property has it at index zero.
2. Every table with system dates ends with creation followed by modification.
3. Every view and embedded section is a stable subsequence of its table's
   canonical order, with title first and system dates last when present.
4. The registry remains valid JSON and non-order configuration is unchanged.
5. The native backend loads the registry, the frontend production build passes,
   and browser QA confirms that a representative table and its views render the
   same column order.

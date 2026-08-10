# Directive: System dates for every Vault table

Every Vault table owns two read-only system properties: the creation date and
the last-modification date. Their displayed names are localized using the
active interface language at table creation or migration time.

## Protocol

1. Normalize the table schema at the single backend table-creation boundary.
   Use the request locale when supplied and otherwise read the current
   interface language from application Settings.
2. Represent the fields with the existing `created_time` and
   `last_edited_time` types, mark them read-only, and use stable property IDs
   when a field has to be created.
3. Stamp the canonical property names on record creation and on every record
   save. Preserve the creation value and replace only the modification value.
4. Keep both system properties after every ordinary property, with creation
   before modification, so new and migrated tables share the same terminal
   field order.
5. Migrate existing schemas and frontmatter idempotently. Recognize old
   system-date types and known localized names, copy their values to the new
   names, update view references, then remove the old properties and keys.
6. Use the file birth time as the creation fallback and the file modification
   time as the modification fallback when an old value is absent.
7. When a table is a deterministic Notion clone, enumerate its configured
   source database through the Notion REST integration and map rows by the
   deterministic clone UUID. Use Notion's top-level `created_time` and
   `last_edited_time` as the authoritative migration values; never match by
   title.
8. Fetch and validate the complete Notion timestamp index before writing any
   Vault file. Write a registry backup and a recoverable copy of every changed
   Markdown file before applying a live migration, and support a dry-run
   report with matched and unmatched row counts.

## Localized labels

The canonical labels are `Data de creació` / `Última modificació` in Catalan,
`Creation date` / `Last modified` in English, `Fecha de creación` / `Última
modificación` in Spanish, and `Date de création` / `Dernière modification` in
French. A locale supplied by the UI is preferred; Catalan is the safe backend
fallback when a caller does not provide one.

## Restrictions and edge cases

- Do not use ordinary editable date fields for these roles: clients could
  overwrite the audit values and the table would no longer be authoritative.
- Do not delete `created_at` or `last_edited_at`; those are internal authorship
  metadata and are separate from table properties.
- Do not classify schema properties named `created_at` or `last_edited_at` as
  system-date aliases. They must remain independent even when their type is
  `date`.
- Do not migrate an arbitrary field merely because it has type `date`; only
  known system-date types or recognized localized/legacy names qualify.
- The migration must be safe to run repeatedly: an already canonical table and
  record must produce no further changes.
- View column lists may contain either field-name strings or descriptor objects;
  replace only strings and leave descriptors intact unless their explicit field
  member is being handled by the view-reference traversal.
- A legacy field may remain in a record after it has disappeared from the
  registry; inspect record keys as well as schema properties before choosing the
  value to migrate.
- Do not fall back to fuzzy title matching for a Notion row. A local-only row
  without a deterministic Notion UUID keeps its existing audit dates or uses
  filesystem timestamps, and the migration reports it as unmatched.
- Do not start the live write phase when any configured Notion database cannot
  be enumerated. A partial timestamp index would silently mix authoritative and
  fallback dates.

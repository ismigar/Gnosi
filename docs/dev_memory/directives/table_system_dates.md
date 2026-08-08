# Directive: System dates for every Vault table

Every Vault table owns two read-only system properties: the creation date and
the last-modification date. Their displayed names are localized using the
active interface language at table creation or migration time.

## Protocol

1. Normalize the table schema at the single backend table-creation boundary.
2. Represent the fields with the existing `created_time` and
   `last_edited_time` types, mark them read-only, and use stable property IDs
   when a field has to be created.
3. Stamp the canonical property names on record creation and on every record
   save. Preserve the creation value and replace only the modification value.
4. Migrate existing schemas and frontmatter idempotently. Recognize old
   system-date types and known localized names, copy their values to the new
   names, update view references, then remove the old properties and keys.
5. Use the file birth time as the creation fallback and the file modification
   time as the modification fallback when an old value is absent.
6. Write a registry backup before applying a live migration and support a
   dry-run report.

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

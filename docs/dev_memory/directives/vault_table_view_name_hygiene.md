# Directive: Vault Table and View Name Hygiene

## Objective

Keep database table names and saved table-view names free of decorative emoji,
including names already persisted in `vault_db_registry.json`. The locked main
view of each table must use exactly the same cleaned name as its table.

## Protocol

1. Normalize names at the registry boundary while loading existing data.
2. Normalize names again on table and view create, rename, and update routes so
   new writes cannot reintroduce emoji.
3. Identify a main view by its explicit main/default marker or the legacy main
   names, then set its name to the owning table's name.
4. Keep the main-view lock semantics based on `is_main`; do not make the main
   view renameable or deletable as part of this migration.

## Restrictions / Edge Cases

- Do not normalize arbitrary property values, page titles, icons, or database
  names; this directive applies only to table names and table-view names.
- Remove emoji characters without transliterating the remaining text, so
  accents and meaningful punctuation survive.
- If a name contains only emoji or whitespace, use a stable non-empty fallback
  (`Untitled Table` for tables and `View` for non-main views).
- The migration must be idempotent: a second registry load must not change the
  already-normalized data.

## Verification

- Unit-test prefix, infix, suffix, and emoji-only names.
- Verify that existing main views become exactly their table name and remain
  marked `is_main`.
- Verify create, rename, and update boundaries reject emoji in persisted names.

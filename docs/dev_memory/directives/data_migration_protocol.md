# Directive: Gnosi data migration protocol

This directive governs migration from external systems into Gnosi's
decentralized Vault and Drupal architecture.

## Protocol

1. **Extract the source schema** before migrating. Map source Select,
   Multi-select, Relation, and other types to Vault types.
2. **Resolve relations** as UUID references in Vault Markdown or Drupal
   entities.
3. **Make migration idempotent** by using `source_id` as a unique key so
   repeated runs do not duplicate records.

## Type mapping

| Source type | Gnosi type | Notes |
|---|---|---|
| title | text (primary) | Page or file name |
| select | select | Preserve options |
| multi_select | multi_select | Preserve all values |
| relation | relation | Map to table ID and record UUID through `source_id` |

## Neutral metadata

- `source_id`: stable identifier from the source system.
- `area_id`: hierarchical reference to the parent area.
- `database_table_id`: target table identifier, for example `projects`.

## Restrictions

- Download files and images into a local `/media` or `Assets/Covers`
  directory referenced by Markdown.
- Avoid provider brand names in normalized labels and data fields.
- Normalize or explicitly support emoji in source column names.

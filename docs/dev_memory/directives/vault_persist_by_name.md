# Persist Vault Metadata by Name

## Objective

Markdown frontmatter stores human-readable property names, never opaque
`fld_*` keys. Immutable field IDs remain in the registry for views, filters,
and schema references. Column renames use aliases instead of mass-rewriting
every page.

## Registry model

Each property may contain `aliases: []` with previous names.

## Field resolution

`field_resolver.py` supports:

- Resolve by field ID, current name, or alias.
- Convert any resolvable metadata key to its current storage name.
- Return response metadata only under current names.
- Preserve genuinely unknown local properties.

When multiple input keys resolve to one property, precedence is:

1. Current name.
2. Immutable ID.
3. Alias.

Log collisions.

## Write boundary

`save_page_md` canonicalizes metadata to current names immediately before
serialization. This central boundary protects all callers, including older
frontend clients that still send an ID.

Remove name-to-ID migration from page creation and replacement paths.

Frontend `setMetaValue` writes the current name and removes residual field-ID
keys for that property. Read helpers remain tolerant. Registry-based views,
filters, and sections continue using immutable IDs.

## Page ID guard

No Markdown page may be saved without an `id`.

Before serialization:

1. Use the provided metadata ID.
2. Otherwise recover it from existing frontmatter.
3. If YAML is corrupt, attempt a conservative raw-text recovery.
4. If recovery is impossible, generate a new UUID and log an error.

This prevents a partial cloud read followed by a patch from replacing complete
frontmatter with only the patched field and breaking UUID wikilinks.

`backend/tests/test_save_page_md_guard.py` covers normal writes, disk recovery,
corrupt YAML, UUID generation, and empty metadata.

## Column rename

When a property name changes:

- Add the old name to aliases.
- Deduplicate aliases.
- Remove the new current name from aliases.
- Remove a conflicting alias from another property.
- Save only the registry.

Existing pages resolve through the alias and migrate lazily to the current name
on their next save. API responses show the current name immediately.

## Restrictions

- Field IDs are not deleted; they remain registry identities.
- Unknown semantic frontmatter fields are preserved.
- Never rewrite all pages merely to rename a column.
- A current name always wins over an alias collision.
- Batch cleanup is optional, dry-run-first, backed up, and must use the same
  canonical conversion helper.
- If a page PATCH misses the in-memory ID→path cache, refresh the page index
  once before returning 404. External OneDrive renames can leave a valid
  Markdown file temporarily absent from the cache; repeated rescans per
  autosave are forbidden.

## QA

1. Page responses contain current names and no field-ID keys.
2. A patch by name persists by name.
3. A defensive patch by ID still persists by name.
4. Rename records the alias without rewriting page files.
5. A legacy page under the old name resolves and later migrates lazily.
6. Formulas, relations, filters, and by-table queries retain their values.
7. The page ID guard passes all regression cases.

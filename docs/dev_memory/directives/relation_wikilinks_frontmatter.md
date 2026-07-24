# Relation Wikilinks in Frontmatter

## Objective

Persist relation values as quoted wikilinks containing a readable title and a
stable ID:

```text
[[Title|id]]
```

Remove obsolete body sections that duplicated relation fields and drifted out
of sync.

## Rationale

Obsidian recognizes an exact wikilink inside a property. The title remains
navigable while the alias carries Gnosi's stable ID. Renaming the target can
update the title while preserving the ID.

The cosmetic tradeoff is that Obsidian may display the alias ID in its property
chip.

## Read and write boundaries

On read, canonical frontmatter parsing strips a recognized relation wikilink to
its clean ID. Runtime consumers continue receiving IDs.

On write, `save_page_md` identifies relation fields by schema type, with legacy
name-prefix fallback, and decorates IDs from the page-title index. If the index
is cold, save the ID safely; a later save can repair the decoration.

Manual `[[Title]]` relations may be resolved by a unique title on the next
Gnosi save.

Title-change rewriting operates over frontmatter as well as body content and
preserves aliases.

## Restrictions

- Do not require UUID syntax; legacy IDs may be filenames or other stable
  strings.
- Do not create a wikilink when a title contains syntax-breaking characters or
  line breaks; preserve the bare ID.
- Let the YAML serializer quote bracket-leading values.
- Raw-YAML pipeline consumers must parse the alias as the relation ID.
- Remove a legacy body section only when its heading matches a relation field
  and its complete content contains only relation bullets and blank lines.
- Preserve the entire section if any other content exists.

## Migration record

`pipeline/sandbox/migrate_relation_wikilinks.py` built a complete ID-title map,
decorated relation fields, removed exact legacy sections, backed up changes,
and was idempotent.

A later, explicitly approved purge removed only dangling relation IDs after
live API verification. Required safety:

1. Verify a known live ID returns `200`.
2. Verify a synthetic ID returns `404`.
3. Purge only an ID with no local row and a current `404`.
4. Preserve every timeout, server error, or uncertain result.
5. URL-encode non-UUID IDs.

After mass migrations, rerun the audit the next day and scan duplicate internal
IDs because another OneDrive client can reintroduce old files.

## QA

Test strip/decorate round-trip, schema detection, cold-index fallback, manual
title resolution, unsafe titles, and unrelated fields. Browser QA confirms
relation chips show titles, saved Markdown uses the canonical format, and the
body remains unchanged.

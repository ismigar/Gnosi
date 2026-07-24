# Sidecar Internal Metadata

## Objective

Keep internal rule-engine and template state out of user Markdown frontmatter.
Persist it under:

```text
<vault>/.gnosi/page_meta/<page_id>.json
```

External editors should show semantic page data, not application machinery.

## Sidecar keys

- `is_template`
- `is_default_template`
- Any `*_manual` flag used to protect a user-edited field from automatic
  overwrite

All other properties remain in frontmatter.

Do not create an empty sidecar. Delete an existing sidecar when its internal
metadata becomes empty.

## Read contract

`parse_frontmatter(content, file_path)`:

1. Parse Markdown YAML.
2. Resolve the page ID and vault root.
3. Read the matching sidecar when available.
4. Merge only recognized internal keys, with sidecar values winning.
5. Return metadata and body.

If the root or ID cannot be resolved, preserve legacy frontmatter behavior.

## Write contract

Every page write passes through `save_page_md`:

1. Split frontmatter and sidecar keys.
2. Atomically write clean Markdown.
3. Atomically write a nonempty sidecar.
4. Otherwise remove the stale sidecar.

The two-file operation cannot be fully atomic. A sidecar failure may leave a
small number of internal booleans stale, but must never corrupt Markdown.

Dashboard writers apply the same split to embedded page metadata.

## Migration

`pipeline/sandbox/migrate_sidecar_metadata.py` is idempotent and
dry-run-first. It scans Markdown outside internal and Trash directories,
extracts internal keys, writes the sidecar, and rewrites clean frontmatter.

Report scanned, migrated, unchanged, and failed counts.

## Restrictions

- A page without an ID cannot use a stable sidecar. Preserve its flags in
  frontmatter, warn, and repair the page ID separately.
- If the vault root is unavailable, do not guess a sidecar path.
- Orphaned sidecars are non-destructive and may be handled by a separate
  cleanup tool.
- Concurrent writes use last-writer-wins; normal rule processing is serialized
  per page.
- The sidecar is synchronized user-vault state. Treat cloud I/O failures as
  recoverable and never fail the entire page index.
- Local frontmatter parsers in graph or mail code do not need sidecars unless
  they begin consuming internal flags.

## QA

1. Dry-run the migration.
2. Apply against a backed-up test vault.
3. Verify no migrated Markdown contains internal keys.
4. Verify matching JSON sidecars.
5. Edit a protected field and confirm the rule engine respects its manual flag.
6. Remove all internal flags and confirm sidecar cleanup.

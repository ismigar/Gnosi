# Resources Local-Property Cleanup

## Objective

Clean legacy frontmatter properties in the Resources table without losing data.

## Sources of local properties

- Legacy opaque field-ID keys.
- Original Notion property UUIDs.
- Obsolete Zotero-open fields.
- Lowercase legacy state, source, and description keys.

Current storage policy is defined by `vault_persist_by_name.md`: canonical
frontmatter uses current human-readable property names. Historical notes that
described field IDs as canonical are superseded.

## Cleanup behavior

For each Resources Markdown file:

1. Resolve a known legacy field ID or source UUID to its current property.
2. Copy a nonempty legacy value only when the current property is empty.
3. Remove the legacy key only after its value is preserved.
4. Leave unknown or ambiguous UUID keys untouched.
5. Remove the obsolete Zotero-open property only when empty.
6. Remove redundant legacy state/source values only when the canonical value
   already preserves the information.
7. Preserve any nonempty unmatched description.

The exact UUID mapping belongs in the migration script and tests, not repeated
across runtime code.

## Migration requirements

- Dry-run by default.
- `--apply` required for writes.
- Create a timestamped backup outside OneDrive.
- Use canonical page serialization and sidecar handling.
- Modify only files whose logical metadata changes.
- Refresh backend indexes after apply.
- Rerunning against a clean vault is a no-op.

## Restrictions

- Never delete a value that has not been copied to a canonical field.
- Never overwrite a populated canonical field.
- Never guess ambiguous source UUIDs.
- Do not bypass current storage helpers with a duplicate YAML serializer.
- User bibliographic values remain in their original language.

## QA

Compare dry-run counts with a backed-up fixture, apply, verify no known legacy
keys remain, confirm ambiguous values remain, and prove citations and table
columns still contain the original data.

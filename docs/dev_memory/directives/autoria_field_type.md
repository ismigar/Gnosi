# Structured Authorship Field

> ID: `AUTORIA-FIELD-20260520`
> Status: implemented and migrated.
> Related: `zotero_integration.md` and `cslEngine.js`.

## Objective

Store authors as an ordered list of structured objects instead of an ambiguous
free-text string, enabling deterministic citations.

## Data model

The field type slug remains `autoria` for persisted compatibility.

```json
[
  {"nom": "Lynn", "cognom1": "Margulis", "cognom2": ""},
  {"nom": "Dorion", "cognom1": "Sagan", "cognom2": ""}
]
```

These persisted keys remain unchanged because they are stored data identifiers,
not interface labels. The UI labels are localized, with English defaults.

Author order is significant. This type is structured data and must not be
included in `TRANSLATABLE_FIELD_TYPES`.

## CSL mapping

CSL has `given` and `family`, but no second-surname field:

```text
given  = nom
family = trim(cognom1 + " " + cognom2)
```

`findStructuredAuthors` detects an array with the persisted authorship keys,
independent of the column label. `structuredAuthorsToCsl` maps it directly and
skips the legacy heuristic. String values still fall back to
`parseAuthors`.

Keeping compound surnames together produces the correct citation behavior and
avoids guessing whether a comma separates two authors or a surname and given
name.

## Frontend integration

- `SchemaConfigModal.jsx`: field type entry with localized label.
- `VaultTable.jsx`: `AutoriaEditor`, display pills, ordering, and suggestions.
- `cslEngine.js`: structured-to-CSL mapping plus legacy fallback.
- `BibliographyBlock.jsx`: existing CSL consumer.

Suggestion deduplication uses the complete structured name, not the generic
string-option helper.

## Migration

`pipeline/sandbox/migrate_autoria.py` is dry-run-first, non-destructive, and
idempotent.

The 2026-05-20 apply run changed the Resources column type, converted 150 safe
values, preserved 125 ambiguous strings, left 28 empty values, and created a
dated backup.

Deployment order is critical:

1. Deploy the frontend that understands the structured type.
2. Change the schema type.
3. Convert safe values.

An array of objects rendered by an old text cell can crash React. The apply
path therefore changes the type before converting any value.

The migration aborts on ambiguous values unless `--force` explicitly accepts
preserving them as strings.

Reliable author separators are semicolons and line breaks. A comma is
ambiguous. A period alone does not prove initials; require one-letter initials
or another strong signal. Never split a compound surname heuristically.

## Zotero behavior

Zotero-to-Gnosi writes structured authors when the destination creators field
uses the authorship type:

- `firstName` -> `nom`
- `lastName` -> `cognom1`
- empty `cognom2`

Text fields retain the legacy string fallback. Gnosi-to-Zotero creators remain
read-only under the existing synchronization policy.

## Layout restriction

Structured authorship is a multi-line editor. The BlockEditor properties grid
must use a growing value cell such as `min-h-[2rem] py-1`, not a fixed height.
Labels align to the top.

This rule also applies to files, relations, and multi-select editors. A
multi-line field in a fixed-height row will overlap adjacent properties.

## Edge cases

- Render an empty array as an empty-state marker.
- Continue supporting legacy strings until all ambiguous records are reviewed.
- Preserve list order.
- CSL lookup must not break unrelated field-name compatibility.
- A future creator role may distinguish author, editor, or translator, but is
  outside the implemented schema.
- User names are data and are never translated.

## QA record

Frontend build passed. Interactive browser QA confirmed editing, structured CSL
output, legacy fallback, and dynamic row height with no property overlap.

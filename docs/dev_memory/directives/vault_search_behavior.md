# Vault Search Behavior

## Objective

Keep record filtering and global page search complete, immediate, and free of
editor shortcut collisions across every Vault surface.

## Interaction contract

- A view search filters records on every keystroke in full-page, table-tab,
  split-pane, and embedded views.
- View search text supports `%` as a wildcard and `/pattern/flags` as an
  explicit regular expression, while ordinary text preserves accent-insensitive
  contains behavior.
- Every renderer receives the same controlled `searchTerm`; a header must never
  own search state that is omitted from its view body.
- Global search opens with Option/Alt+K. Cmd/Ctrl+K remains available to the
  editor for link insertion.
- Global search prioritizes direct title and alias matches before tag-only
  matches, then applies its result limit.
- The canonical global id-to-title index supplements the loaded page snapshot
  so an indexed page remains discoverable while the snapshot is partial.

## Restrictions and edge cases

- Do not detect Option+K from `event.key` alone. On macOS, Option+K can produce
  the character `˚`; use `event.code === "KeyK"` and require `altKey` without
  Ctrl, Meta, or Shift.
- Do not slice global results before relevance ranking. A common tag can fill
  the first batch and hide an exact page-title match.
- Do not replace rich page records with id-to-title index entries. Merge only
  missing IDs so folders, metadata, icons, and table context stay available.
- Do not add independent filter logic to individual views. Propagate the
  controlled value into `VaultViewBody` and keep `useVaultViewData` as the
  shared filter engine.
- Keep calendar entries and trashed pages excluded according to the canonical
  page and index semantics.
- Flatten structured metadata into readable values before searching. In
  particular, authorship objects are searched as `nom cognom1 cognom2`, not as
  their JavaScript object representation.

## Validation

1. Unit tests cover Option/Alt+K, rejection of Cmd/Ctrl+K, indexed-only pages,
   aliases, and title-first ranking.
2. A table opened as the main route and as a document tab filters while typing.
3. Browser QA confirms Cmd+K no longer opens global search and Option+K does.
4. Global search returns a direct page-title match ahead of tag-only matches.
5. Frontend i18n validation, focused tests, affected-file lint, and production
   build pass. Report unrelated repository-wide lint failures separately.

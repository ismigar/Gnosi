# Vault Table Cell Grid

## Objective

Give `VaultTable`, and later page properties, spreadsheet-style navigation,
rectangular selection, copy/paste, and range fill without compromising typed
data or virtualized rendering.

## State model

Keep cursor state separate from editor state:

```text
activeCell = { rowId, field }
anchorCell = { rowId, field } | null
editingCell = { rowId, field, originalMetaKey } | null
```

`field` is the schema key. Resolve the actual per-row metadata key with
`getMetaKey(note, field)` at read and write time.

The grid includes the sticky title column and dynamic metadata columns.
Actions and `last_modified` remain outside the grid.

## Title behavior

The title is navigable and editable but uses `note.title`, not metadata.

- First click selects.
- A second click, double-click, Enter, or printable typing opens inline edit.
- Opening the page uses the left action or `Alt+O`, not title double-click.
- Title writes use `PATCH { title }` and separate optimistic state.
- Title values can be copied but never pasted, cleared, or bulk-filled.
- Cursor movement on the sticky title does not force horizontal scrolling.

## Relation item contract

Relation values use one shared item component in table cells, page properties,
gallery cards, boards, and feeds.

- Each item has a stable visual width and truncates only its visible label.
- Hover exposes the complete resolved title, never only the stored page ID.
- An open action creates or focuses the related page's Gnosi document tab.
- An unlink action removes only that relation value from the current record. It
  never deletes or trashes the related page.
- Unlink persists as a partial metadata patch and registers one global history
  operation containing the page ID, persisted metadata key, previous value, and
  next value.
- The bottom-right notification offers Undo. Command/Ctrl+Z uses the same
  global operation, and redo restores the unlink.
- Page-property editors must cancel pending debounced metadata writes before an
  unlink so a stale full-metadata save cannot recreate the removed relation.
- Undo/redo must update the active table cache as well as the global page list.
  Keep the history value protected in the cell's optimistic layer until a
  table-specific refresh settles; an older unlink refresh can otherwise repaint
  the removed value even after the server has restored it.
- Relation action clicks stop propagation so they do not select, edit, drag, or
  open the containing cell or card.

## Interaction

- Arrow keys move the cursor.
- Page-property cursor changes move DOM focus to the matching property row and
  scroll it into the nearest visible position so navigation follows the nested
  page scroller.
- Page-property editors must render `status` fields as single-value option
  pickers, just like `select`; status catalogs are strict and must not expose
  inline option creation or deletion.
- Shift plus arrows or click extends a rectangular selection.
- Escape closes editing without saving; outside editing it clears selection.
- Enter saves text or number edits and moves down.
- Space or Enter toggles a focused checkbox.
- Formula, rollup, and button cells are navigable but read-only.
- File and image cells open their picker.
- Printable typing replaces content only for supported scalar editors.

A plain click selects; it does not immediately edit. This is necessary so copy
commands target a cell rather than input text.

## Copy and paste

Copy stores:

1. A session-local matrix preserving arrays, numbers, and objects.
2. A TSV representation in the system clipboard for Excel and external apps.

Paste prefers the internal matrix. Otherwise it parses clipboard TSV.

Geometry:

- A single destination cell expands the source block down and right within
  table bounds.
- A selected destination range tiles the source matrix with modulo indexing.
- Paste never creates rows.

## Type coercion

`cellGridUtils.js` centralizes coercion:

- Text: string conversion.
- Number: finite numeric values only.
- Select/status: existing option by ID or label only.
- Multi-select: array or comma-separated input filtered to existing options.
- Relation: existing related row by ID or title only.
- Date: preserve `YYYY-MM-DD` and avoid UTC day shifts.
- Datetime: preserve ISO instants or parse to a valid instant.
- Period: valid `YYYY-MM-DD/YYYY-MM-DD`.
- Checkbox: booleans, empty false, and recognized localized truthy/falsy
  tokens. Unknown text is skipped.
- Structured authorship: internal structured arrays only.
- Formula, rollup, button, and title: never pasted.

Invalid coercions skip the cell and contribute to a visible skipped-count
message. Paste never creates catalog options or relations.

## Bulk writes

`applyBulkCellUpdates`:

1. Deduplicates by row and key; last update wins.
2. Applies one optimistic state update.
3. Sends page patches with `Promise.allSettled`.
4. Refreshes once after completion.
5. Rolls back only failed cells and reports the failure count.

Do not call the single-cell save handler once per pasted cell.

## Virtualization

Keyboard movement uses state, not DOM focus, because off-screen rows unmount.
The window-level listener operates on `activeCell`.

Use `rowDescriptors` as the visual order, include expanded subitems, and call
`rowVirtualizer.scrollToIndex()` for off-screen targets. Trigger lazy loading
when movement reaches the last loaded row.

Clear cursor and range when view, search, sort order, or row identity changes.

## Shortcut coexistence

- Existing row selection keeps Command/Ctrl+A.
- Delete clears cells only when no rows are selected.
- With selected rows, Delete retains row-deletion behavior.
- Command/Ctrl+Backspace deletes the cursor row only when there is no
  multi-row selection.
- `Alt+O`, `Alt+R`, and `Alt+P` invoke open, open resource, and open parallel.
- Use `event.code` for Alt shortcuts on macOS.
- Ignore grid shortcuts while an unrelated input, textarea, or editable
  element has focus.

## Safe QA

- Never type into real notes during automation; autosave can persist through
  WebSocket paths.
- Use disposable pages or block page PATCH requests.
- Unit-test TSV parsing, serialization, range geometry, and every coercion.
- Run the production frontend build.
- Browser-test navigation, editing, paste, failure rollback, virtualization,
  and shortcut conflicts.
- For relation unlink QA, use a disposable relation or restore the original
  value with Undo before finishing.

## Restrictions

- Do not assume schema keys equal persisted metadata aliases.
- Persist multi-select and relation values as arrays, not CSV.
- Never silently coerce invalid values to empty or false.
- Preserve the special write path and paste exclusion for title.
- Clear stale selection after table-order changes.
- Do not treat relation unlink as page deletion or reuse the trash restore API.
- Do not show action controls on multi-select values; the relation item contract
  applies only to fields whose schema type is `relation`.
- Do not omit `onNoteSelect` from any `VaultViewBody` table context. The main
  table route, table-tab renderer, split-table renderer, and embedded renderer
  must all forward the open callback; otherwise the visible Open action throws
  while Open Parallel keeps working through its separate callback.
- Do not refresh only the global page list after relation history changes; table
  panes keep their own record cache and would remain visually stale.
- Do not update only the page-property cursor state during keyboard navigation;
  the focused row can leave the viewport without moving the nested page
  scroller. Focus the matching row without implicit scrolling, then explicitly
  scroll it into the nearest visible position.

# Directive: Vault Views Management

This directive defines how data views (tables, galleries, kanbans, timelines) should be implemented and maintained in the Gnosi Vault, ensuring consistency in filtering, sorting, and searching.

## View Implementation Protocol

### 1. Unified Data Logic (`useVaultViewData`)
All views must use the `useVaultViewData` hook to process notes. No ad-hoc filtering or sorting logic should be implemented within the view components.

**View configuration fields:**
- `filters`: Object with `conjunction` ('and'|'or') and `conditions` (array of conditions or groups).
- `sorts`: Array of objects `{ field, direction }`.
- `search`: String for global textual search.
- `visibleProperties`: Array of property names to display.

### 2. View Toolbar (`VaultViewToolbar`)
Each view must display a header or toolbar containing:
- A search input that filters in real-time across all visible properties (or title/content).
- A quick access button to open/close the filter panel.
- An indicator of how many filters and sorts are active.

### 3. Persistent Configuration
- View configurations are stored in `vault_db_registry.json` via the `/api/vault/views` endpoint.
- In the case of embedded views (`InlineDatabase` in `BlockEditor`), configurations are stored as block attributes to allow page-specific custom views.

## Restrictions and Special Cases
- **Search**: Must be "fuzzy" or at least case-insensitive across the note's title and metadata.
- **Dates**: Date sorting must account for ISO formats and missing values (keeping empties at the end).
- **Relations**: Relation filtering must allow the special value `{{self}}` to filter notes that link to the current page (Backlinks).
- **Visual Consistency**: Embedded views must have the same appearance and functionality as full-screen views in the Dashboard.

## Validation
Before considering a view complete, verify:
1. That the search works correctly in both table and gallery views.
2. That adding a filter from the configuration modal applies it immediately and saves it.
3. That multi-column sorting prioritizes fields according to the order defined in the `sorts` array.

## Edge cases and regressions

- **Reloading `/vault/table/:id` renders no columns.** Do not select the table
  from the URL until `registry.tables` contains its ID. An empty array is
  truthy, so checking only `registry.tables` runs too early.
  `handleTableSelect` can set `activeTableId` while failing to set schema from
  an empty registry. When registry loading finishes, the ID equality guard
  prevents another call and `dynamicColumns` remains empty. Guard with
  `if (!registry.tables?.some((table) => table.id === tableId)) return;`.

- **Sorting by a sparse column appears to hide populated rows.** Empty values
  sorted first can occupy the initial virtualized batches, making non-empty
  rows appear missing. In `useVaultViewData`, place empty values last for both
  ascending and descending order, for every field type:
  `if (aEmpty || bEmpty) { if (aEmpty && bEmpty) continue; return aEmpty ? 1 : -1; }`.
  When content seems missing, inspect `activeView.sort` before suspecting cell
  rendering; sorting reorders rows but does not change the total count.

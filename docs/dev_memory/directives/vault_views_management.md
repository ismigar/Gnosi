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
- **Gallery document previews**: Content previews must use the shared Vault Markdown renderer inside an independently scrollable card surface. Do not reduce Markdown to plain text with regular expressions; that exposes managed comments, breaks wikilinks, and removes navigation. Do not treat the body carried by the gallery listing as complete; load the full page preview lazily when a content card approaches the viewport, otherwise long documents and wikilinks can be cut mid-token. Content and property cards must keep their controls interactive without triggering the card-level open action, and must expose a compact control for opening the record in a separate browser tab.
- **Navigating from a gallery preview**: A page editor can unmount while its target opens in another tab. Preserve every BlockNote toggle's expansion state per page using a stable document-path key before unmount, then restore that state against the editor's newly generated block ids before inserting parsed blocks. Do not use volatile BlockNote block ids as the persisted key.
- **Interactive gallery wikilinks**: Open a gallery-preview wikilink in a parallel pane when that handler is available. This keeps the source editor mounted, so its expanded sections remain visible while the linked page is read.

## Validation
Before considering a view complete, verify:
1. That the search works correctly in both table and gallery views.
2. That adding a filter from the configuration modal applies it immediately and saves it.
3. That multi-column sorting prioritizes fields according to the order defined in the `sorts` array.

## Edge cases and regressions

- **The view picker is detached from its add button or extends past the viewport.**
  Anchor the management popover to the add-view button's viewport rectangle,
  clamp its horizontal position, flip it above the button when the space below
  is insufficient, and bound its height with internal scrolling. Keep view
  names in a flexible multi-line column so badges and actions do not reduce
  them to an unreadable fragment. The table view manager does not expose a
  show/hide toggle: page-embed visibility is derived from view semantics, not
  configured as table chrome.

- **Opening an embedded view configuration causes a black screen.** Do not place
  hooks such as `useMemo`, `useEffect`, or `useSensors` after the `if (!isOpen)
  return null` guard in `PageViewModal`. Embedded modals are mounted closed and
  then opened, so conditional hooks change React's hook order and cause
  `Rendered more hooks than during the previous render`. Declare every hook
  before the closed-state return.

- **The existing-view picker only shows “Create new view”.** A view request is
  asynchronous. Reset stale entries and render a disabled loading state while
  it is pending. If the request fails, keep creating a view available but show
  a localized error with an explicit retry action; never silently present an
  empty list as if the table had no saved views.

- **The existing-view picker remains on “Loading views…” after a successful
  response.** Set the requested table id together with the loading state before
  starting the request, accept only the latest request result, and transition
  the status to `ready` or `error` for that same table. Copy and validate the
  response array before adding the virtual main view; do not mutate a response
  object in place, because stale or reused response data can otherwise leave
  the picker in a permanent loading state.

- **An empty embedded calendar shows only its toolbar.** The embedded calendar
  has no parent height to inherit. Give its calendar container a minimum height
  and let FullCalendar calculate its own height, so the month/week/day grid is
  drawn even when there are no matching records. Keep the full calendar page on
  its existing viewport-filling height.

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

- **Changing Kanban group order has no visible effect.** Persisting
  `groupSort` and `groupSortDir` in the view modal is insufficient: the Kanban
  renderer must apply both values when ordering its column keys, and embedded
  views must propagate both camelCase and snake_case variants into the renderer
  view model. The embedded modal's returned section data must also include all
  type-specific extras; otherwise the editor immediately rewrites the block
  without the newly selected order. Catalog order uses the schema option order,
  alphabetical order uses the displayed label, and count order uses the number
  of records in each bucket. Keep the empty value bucket last in both ascending
  and descending directions. When confirming an embedded shared view, always
  upsert the registry view before writing the page section; do not gate the
  shared-view write solely on generic JSON change detection. Otherwise the
  section can contain the new direction while the registry keeps the old one,
  and the embed correctly prioritizes the stale shared source of truth.

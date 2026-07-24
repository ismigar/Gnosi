# Directive: Resolve relation IDs to titles

## Objective

Relation fields must display referenced record titles rather than raw IDs.

## Architecture

`VaultDashboard.jsx` maintains the `globalIndex` state, passed to children as
`idToTitle`, mapping `page_id` to title. This is the single display source.

The backend builds it through `build_id_title_index()` across Vault and
dashboard content and serves it from `GET /api/vault/global-index`.

## Accumulative index rule

Every local update must merge with previous state:

```js
setGlobalIndex((previous) => ({ ...previous, ...newEntries }));
```

Never replace it with a partial active-table map. The only authorized complete
replacement is a fresh response from the global-index endpoint.

After `fetchPagesByTable`, refresh the complete backend index. Child
components such as Table, Gallery, Feed, and BlockEditor must receive
`idToTitle`; they must not derive isolated maps from their current pages.

## Rendering fallbacks

If an ID is missing:

1. When the schema has `relation_database_id`, enrich a display map with
   `allNotes` from that table.
2. As a final fallback, show a truncated ID rather than the full opaque value.

Every relation-rendering component should use an equivalent helper that merges
`idToTitle` with related-table titles. It therefore needs complete
`allNotes`, not only the active table.

## Expected flow

1. App startup loads the complete global index.
2. Table navigation merges newly fetched pages and refreshes the global index.
3. `syncPagesState` adds entries for new pages.
4. No partial operation deletes existing entries.

## QA

- Navigate between tables with cross-relations.
- Verify titles in read, edit, gallery, and feed modes.
- Create a record and verify references resolve immediately.

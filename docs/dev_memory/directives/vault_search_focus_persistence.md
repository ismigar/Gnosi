# Directive: Preserve an active table search after focus loss

## Objective

Keep the Vault table-view search control visible when it loses focus while its
input contains a search query. Close it on blur only when the input is empty.

## Implementation

1. Locate the expandable search input in `VaultViewsHeader.jsx`.
2. In its blur handler, inspect the input's current DOM value rather than a
   possibly stale render-state value.
3. Keep the existing explicit clear button behavior unchanged: it clears the
   query and collapses the control.

## Restriction / Edge Case

Do not use a captured React state value alone in the blur callback, because an
input can lose focus before its parent has committed the latest controlled
value. Use `event.currentTarget.value` so non-empty queries remain visible.

## Required validation

1. Run the focused frontend test suite and `npm run build`.
2. In the browser, enter a query in a table search, focus a different element,
   and verify that the query and search field remain visible.
3. Clear the query, focus a different element, and verify that the compact
   search icon returns.

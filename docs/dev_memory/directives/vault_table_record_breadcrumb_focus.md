# Directive: Restore the originating table record after breadcrumb navigation

## Objective

When a user opens a record from a table and returns through the table breadcrumb,
restore keyboard focus to that same record instead of the first table record.

## Implementation

1. Store the record and originating table/view when opening the record, but keep
   the restoration request disarmed while the table is being left.
2. Arm that request only when a breadcrumb navigates back to its originating
   table.
3. Pass an armed request to the table view once, then mark it consumed only after
   its target title cell has received focus.

## Restrictions / Edge Cases

Do not arm focus restoration when opening the record: the outgoing table remains
mounted briefly and would consume the request before breadcrumb navigation. Keep
the originating view identifier so returning to a non-default view restores the
same visible record.

Do not reset the table cursor just because a search term changes. When clearing
a search, the previously active record can be visible in the restored result set
and must remain the cursor target; fall back to the first record only when that
active cell is no longer available.

When a preserved record was outside the viewport while the search was active,
scroll its virtual row into view before returning DOM focus to its title cell.

## Required validation

1. Run the focused frontend tests and the frontend build.
2. In the browser, open a non-first table record, return through the breadcrumb,
   and verify that the same record is focused and visible.
3. Repeat from a non-default table view.
4. Search for a non-first record, select it, clear the search, and verify that
   the selected record remains the table cursor.
5. Repeat with a record outside the initial viewport and verify that it is
   scrolled into view.

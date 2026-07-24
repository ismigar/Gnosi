# Derived Article Cleanup

> Historical incident response.

## Context

An automation loop created hundreds of derived article pages whose translation
or origin metadata caused them to trigger the same workflow again.

## Cleanup

The cleanup tool:

1. Fetches all rows from a configured table.
2. Classifies a page as derived only when a recognized origin or nonempty
   translation-reference field proves it.
3. Prints ID, filename, title, and reason in dry-run mode.
4. Deletes only with explicit execution mode.
5. Records deleted pages and timestamps.

## Safety

- Never execute without reviewing dry-run.
- Use the page ID returned by the API.
- Empty origin and translation fields do not make a page derived.
- Preserve uncertain pages.
- Stop the triggering automation before cleanup.
- Prefer current soft-delete behavior so accidental classification remains
  recoverable.

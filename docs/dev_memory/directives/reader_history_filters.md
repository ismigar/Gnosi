# Directive: Reader history and filters

**Status:** Staging
**Date:** 2026-04-09
**Related:** Reader, UX, Database

## Requirements

1. Do not discard older articles solely by date when the feed still provides
   them.
2. Let users filter articles by source.
3. Make switching between unread-only and complete history, including read
   items, straightforward.

## Implementation

### Ingestion backend

- Remove date-window restrictions from `feed_ingester.py`.
- Preserve URL uniqueness to prevent duplicates.

### API

- Add `source_id` as a query parameter.
- Include source summaries in `/api/reader/articles` responses for frontend
  filtering.

### Frontend

- Keep `selectedSourceId` state.
- Provide a filter reset action.
- Persist the show-read toggle for the session.

## QA

- Source-filter counts match database rows for the selected `source_id`.
- Loading hundreds of historical articles remains responsive. Add
  virtualization if real-world volume makes it necessary.

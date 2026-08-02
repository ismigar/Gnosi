# Minimalist Reader Redesign

**Status:** staged and iterated
**Primary file:** `frontend/src/pages/ReaderDashboard.jsx`

## Objective

Reduce visual noise while preserving `AppHeader`, existing design tokens,
reader behavior, and safe RSS rendering.

## Visual direction

- Typography carries the hierarchy.
- Use one accent color.
- Replace cards with hairline separators.
- Keep secondary actions text-only.
- Use a narrow reading column.
- Keep empty states simple.
- Support light and dark themes through existing CSS variables.

## Layout

Desktop uses three columns:

1. Channels and categories.
2. Article list.
3. Reader.

The channel column groups sources by category and keeps uncategorized sources
last. The article list groups entries into today, yesterday, this week, this
month, and older.

The podcast control is a quiet footer bar rather than a prominent card.

On mobile, channels use a drawer with overlay, close control, and automatic
close after source selection. Preserve the existing article/list responsive
switch and reader back button.

## Data behavior

Use separate requests for:

- Visible articles filtered by source and pending/history mode.
- Unread counts across all sources.

This keeps source counts stable while users change filters.

Feed subscriptions are managed centrally in Settings → Reader. Do not restore
an in-page feed-manager button or modal in the Reader dashboard; the duplicate
entry point was non-functional. Preserve polling, synchronization, podcast
generation, mark-as-read behavior, and all existing endpoints.

## OPML categories

The backend derives a feed category from the nearest ancestor outline without
an `xmlUrl`. Nested category paths currently collapse to the nearest folder;
full hierarchy is future work.

## Security

RSS HTML remains inside an iframe with a restrictive sandbox. Never replace it
with direct HTML injection into the application DOM.

## i18n

Every visible string uses `react-i18next` and exists in all supported locales.
English is the deterministic default. Date formatting follows the selected
interface locale.

Persisted category names from imported feeds are user/source data. Map known
legacy uncategorized sentinel values to the localized UI label without
rewriting user data.

## Repository rule

Only `monorepo/apps/gnosi/` is authoritative. The removed root-level mirror is
not a valid target.

## QA

1. Production frontend build passes.
2. Browser verifies source selection, temporal groups, pending/history toggle,
   correct counts, theme behavior, mobile drawer, podcast controls, and
   mark-as-read.
3. Subscription management remains available in Settings → Reader.
4. RSS content stays sandboxed.
5. English appears on a fresh profile and another language persists after user
   selection.

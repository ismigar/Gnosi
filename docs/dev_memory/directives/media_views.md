# MediaCenter Filters and Views

## Scope

Phase 1 adds inexpensive filters, sorting, and durable user metadata to
MediaCenter. Later phases add EXIF indexing, saved views, timeline grouping,
and facets.

## User metadata

Tags and descriptions are semantic user data and belong in the synchronized
vault:

```text
.gnosi/media_metadata.json
```

Use a versioned JSON object keyed by media root plus POSIX relative path, not
filename alone. Duplicate filenames can exist in different albums.

Load lazily, cache in memory under an `RLock`, and write atomically through a
temporary file in the same directory followed by `os.replace`.

If no sidecar exists, metadata defaults to empty. Normalize tags with
`lower().strip()` on both write and filter.

This fixed the previous route failure where `update_metadata` was called but
not implemented.

## Phase 1 filters

Backend supports:

- Media kinds.
- Extensions.
- Case-insensitive filename query.
- Description query.
- Any, all, and none tag sets.
- Minimum and maximum size.
- Modification-date range.
- Sort by modification time, filename, size, or kind.
- Ascending or descending direction.

Apply filters to the cached scan and paginate afterward. Returned total is the
filtered total.

EXIF capture date and GPS filters are deferred because opening tens of
thousands of OneDrive files is not viable without a persistent index.

## Frontend

The toolbar provides translated controls for kinds, date presets, tags, size,
sort, direction, and reset. State becomes API query parameters. Debounce text
and tag input, and reset pagination when filters change.

English is the default UI language; every label is present in all supported
locale files.

## Restrictions

- Do not read file bodies or EXIF during phase 1 filtering.
- Keep scan-cache invalidation behavior after uploads.
- User metadata belongs in the vault; derived EXIF indexes belong in local
  data, not OneDrive.
- Online-only files may still carry stored tags and descriptions because the
  sidecar is separate.
- Guard the single JSON sidecar with one lock and atomic replacement.

## Future phases

- Phase 2: persistent local EXIF index for capture date and GPS.
- Phase 3: saved media views in `.gnosi/media_views.json`.
- Phase 4: timeline grouping and a facets endpoint.

## QA

1. Update tags and description and inspect the durable sidecar.
2. Restart the backend and verify metadata remains.
3. Test every filter, sort direction, and combined pagination.
4. Confirm tag normalization avoids case duplicates.
5. Run frontend build and browser smoke test.

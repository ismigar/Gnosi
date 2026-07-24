# Media Archive Indexing

## Context

`MediaCenter` lists photos under `VAULT/Images`. Production contains roughly
56,000 images across about 99 albums on OneDrive, which requires a different
strategy from a small local directory.

## Root causes

- The UI initially selected an empty `General` album, making the archive appear
  empty.
- Recursive `Path.rglob()` followed by a separate `stat()` per file caused
  more than a minute of cloud-aware I/O.
- The album loader existed but was never called.
- The route ignored frontend `limit` and `offset`.

## Indexing policy

- Use recursive `os.scandir` and reuse `DirEntry.stat()` metadata.
- Cache scans in memory for five minutes per target directory.
- Protect each target scan with its own lock.
- Invalidate the relevant cache after upload or any media mutation.
- Default `activeAlbum` to `null`, meaning all photos.
- Load albums on mount.
- Propagate pagination through the API.
- Use an explicit five-minute client timeout for the first cold scan.
- Apply `encodeURIComponent` to album names.
- Use lazy-loaded thumbnails while ensuring the first viewport rows start
  loading immediately.

Reference code:

- `backend/services/media_service.py`: `_scan_recursive`,
  `_scan_with_cache`, scan locks, and invalidation.
- `backend/api/vault_routes.py`: media pagination.
- `frontend/src/pages/MediaCenter.jsx`: default album, album loading, timeout,
  and encoded URLs.

## Expected performance

- First cold OneDrive scan: approximately 25–40 seconds.
- Subsequent cached requests: under one second.
- Album endpoint: about 99 albums.
- Initial grid: first 50 photos with pagination.

Persisting the index in local SQLite or JSON and warming it in the background
remain future improvements.

## Serving online-only images

The native backend should use the selected `FilesProvider` abstraction. Do not
hard-code `host.docker.internal` or direct `st_blocks` logic in route handlers.

When a provider reports an online-only file:

1. Request materialization through the provider.
2. Coalesce concurrent requests for the same path.
3. Limit concurrent provider operations.
4. Refresh filesystem metadata after success.
5. Return a deliberate unavailable response after a bounded failure.

For already materialized cloud files, serialize enough initial reads to avoid
File Provider saturation and retry only transient `EDEADLK`/`EAGAIN` errors
with exponential backoff.

Historical Docker behavior required a host daemon because container reads did
not trigger macOS File Provider hydration. That daemon is still available as a
recovery tool, but native mode is the default. Runtime-specific URLs must be
selected through environment detection.

## User experience

If a thumbnail cannot be materialized, show a translated cloud-unavailable
placeholder instead of a black image. Do not expose provider-specific or
non-English fallback text.

## Restrictions

- Never run a separate `stat()` for every file after listing a large cloud
  tree.
- Do not cache a partial scan as complete.
- Cache invalidation is mandatory after mutations.
- Album names may contain spaces and Unicode.
- The photo library bundle is a distinct structure and may need explicit
  exclusion or a separate importer.
- The warmup helper must run on the host when Docker is used; running it in the
  container defeats its purpose.
- A provider failure degrades individual media, not the entire archive.

## Verification

1. Cold `GET /api/vault/media?limit=10&offset=0` completes within the extended
   timeout.
2. A second request is served from cache in under one second.
3. `/api/vault/media/albums` returns real albums.
4. The browser starts on all photos, shows albums, renders thumbnails, and
   paginates.
5. Upload invalidates the cache and the new image appears.
6. Online-only and provider-failure states render a localized placeholder.

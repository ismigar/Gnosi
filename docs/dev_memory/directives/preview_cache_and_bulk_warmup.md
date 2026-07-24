# Preview Cache and Bulk Warmup

## Objective

Serve page previews quickly even when Markdown lives in cloud storage. Avoid
serial multi-second provider reads for every item in a feed.

## Implementation

- Process-local LRU cache keyed by page ID and validated by file mtime.
- Maximum 1,000 entries.
- One `_fetch_preview_with_cache` entry point.
- In-flight request deduplication per page ID.
- Proactive `FilesProvider` materialization when required.
- Bulk warm endpoint with bounded concurrency and per-item timeout.
- One fire-and-forget bulk request when a feed row signature changes.

The individual preview endpoint remains the fallback when bulk warmup fails.

## Rules

1. Use mtime validation rather than a fixed TTL.
2. Move cache hits to the end for real LRU behavior.
3. Share concurrent work through one future and clean it in `finally`.
4. Limit bulk concurrency to protect cloud providers.
5. Bound each item so one stuck file cannot block the batch.
6. Disable full-vault scans for missing bulk IDs; stale IDs must fail quickly.
7. Preserve the existing preview response contract.

The cache is intentionally per process and empty after restart. If persistence
is later required, store it under local data, not the synchronized vault.

## QA

1. First live preview warms and returns successfully.
2. Second call is an immediate cache hit.
3. A direct preview after bulk warmup is fast.
4. A stale ID fails quickly without a vault scan.
5. Concurrent requests trigger one provider read.
6. Editing the Markdown changes mtime and invalidates the cache.

## Architectural lesson

Frontend retry and eager-fetch patches do not solve a backend cloud-I/O
bottleneck. Cache and materialize where the slow operation actually occurs.

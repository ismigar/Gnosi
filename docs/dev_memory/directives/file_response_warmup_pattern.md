# Directive: OneDrive warmup before every FileResponse

## Objective

Every endpoint serving a physical file through `FileResponse` must handle an
online-only OneDrive placeholder **before sending headers**. Otherwise FastAPI
can send `200 OK`, then fail mid-stream with `Errno 35`, leaving the browser
with a truncated response.

## Scope

Apply this pattern to every backend endpoint that returns a local
`FileResponse`. Existing references include `_serve_file_with_containment`
for assets and raw Vault files, and `serve_local_file`.

## Protocol

Before creating `FileResponse`:

```python
# 1. Proactively materialize online-only content.
try:
    provider = get_files_provider()
    stat_result = path.stat()
    if provider.is_online_only(path, stat_result):
        await provider.materialize(path)
        try:
            stat_result = path.stat()
        except OSError:
            raise HTTPException(
                503,
                "File temporarily unavailable",
                headers={"Cache-Control": "no-store, must-revalidate"},
            )
        if provider.is_online_only(path, stat_result):
            raise HTTPException(
                503,
                "File warmup pending; try again",
                headers={"Cache-Control": "no-store, must-revalidate"},
            )
except HTTPException:
    raise
except Exception as exc:
    log.debug("Proactive warmup failed for %s: %s", path, exc)

# 2. Probe one byte with backoff before streaming.
last_error = None
for attempt in range(5):
    try:
        with open(path, "rb") as stream:
            stream.read(1)
        last_error = None
        break
    except OSError as exc:
        last_error = exc
        if exc.errno == 35 and attempt < 4:
            await asyncio.sleep(0.2 * (2 ** attempt))
            continue
        break

if last_error is not None:
    raise HTTPException(
        503,
        "File temporarily unavailable; try again",
        headers={"Cache-Control": "no-store, must-revalidate"},
    )

return FileResponse(path=str(path), media_type=media_type)
```

## Restrictions

- Add `Cache-Control: no-store, must-revalidate` to every 503. Otherwise
  Chrome can cache the transient failure and keep the file broken until a hard
  refresh.
- Never return 200 before the one-byte probe. A later body failure corrupts
  the response.
- Keep the established exponential delays of 0.2, 0.4, 0.8, and 1.6 seconds
  consistent across endpoints.

`Errno 35` comes from macOS File Provider when OneDrive content exists only
in the cloud. Materialize it before reading.

## Validation

Request a known online-only file twice. The first request can return a
non-cacheable 503 or wait while materialization completes. The second must
return the complete file immediately, never a truncated 200 response.

Related implementation: `serve_local_file` and
`_serve_file_with_containment`.

# Debugging directive: Photo viewer image serving

## Context

The photo viewer can list images correctly while thumbnails remain blank.
This means the backend can read the directory, but the
`/api/vault/images/...` serving route fails.

## Suspected cause

In `monorepo/apps/gnosi/backend/api/vault_routes.py`, `serve_vault_image`
uses `.resolve()` to verify containment under `VAULT/Images`:

```python
img_root = (get_p("VAULT") / "Images").resolve()
requested = (img_root / image_path).resolve()

if not str(requested).startswith(str(img_root)):
    raise HTTPException(status_code=403, detail="Access denied")
```

On macOS with OneDrive, `~/Library/CloudStorage/...` can resolve to a different
physical prefix such as `/Volumes/...`. Spaces and URL encoding can also
produce false `403` or `404` responses.

## Verification

1. Create a `sandbox/` script that resolves paths using the actual runtime
   configuration.
2. Check whether string-prefix containment fails for the same logical
   directory.
3. Verify URL decoding of spaces in `image_path`.

## Safe fixes

- Prefer `os.path.commonpath` or `Path.is_relative_to` over string-prefix
  containment.
- Preserve correct URL decoding through to the filesystem layer.
- If `.resolve()` causes cloud-path aliasing, use normalized absolute paths
  without resolving symlinks only when equivalent containment security is
  maintained.

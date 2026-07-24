# Vault Trash

> ID: `vault_trash_v1`
> Status: active
> Retention: 90 days

## Objective

Replace immediate page deletion with recoverable soft deletion. Move the
Markdown file into `.trash/{page_id}/`, store restoration metadata in a
sidecar, and purge expired entries through the scheduler.

## Storage

```text
VAULT/.trash/{page_id}/page.md
VAULT/.trash/{page_id}/_trash.json
```

The sidecar stores ID, title, UTC deletion time, original vault-relative path,
original parent ID, table ID, and size.

## Soft delete

`DELETE /api/vault/pages/{id}`:

1. Resolve and read the source page.
2. Create the page-specific trash directory.
3. Move the Markdown file with `shutil.move`.
4. Atomically write the sidecar.
5. Remove the page from link and page indexes.
6. Return deletion time, original path, retention, and restoration deadline.

If the trash entry already exists, return its existing state idempotently.
Assets remain in place until a later explicit cleanup policy can prove
ownership.

## Restore

`POST /api/vault/pages/{id}/restore`:

1. Read the sidecar.
2. Reject an occupied destination with `409`.
3. Recreate missing parent directories.
4. Move the page to its exact original path.
5. Remove the trash directory.
6. Reindex and return the restored path.

The sidecar is the restoration source of truth; never infer the original
directory from a filename.

## Listing and purge

`GET /api/vault/trash` returns valid sidecar entries ordered by newest deletion
and supports an optional case-insensitive title query.

`DELETE /api/vault/trash/{id}` permanently removes one entry after application
confirmation.

`DELETE /api/vault/trash` empties the trash in one server request. It processes
entries sequentially or with bounded resource use, continues after individual
failures, and returns purged count, failed IDs, and freed bytes.

Never implement empty-trash as many concurrent client requests; it can exhaust
the database connection pool and produce hidden partial failure.

The daily `purge_trash` scheduler task permanently removes entries at least 90
days old and reports count and bytes.

## User experience

- Normal delete immediately soft-deletes and shows an Undo toast.
- Permanent purge uses the application's accessible `ConfirmModal`.
- Never use `window.confirm`, `alert`, or `prompt` for destructive actions.
- The trash view supports restore and permanent purge.
- Global search excludes `.trash` by default.
- Every user-visible label and fallback is localized, with English defaults.

## Restrictions

- Keep `.trash` excluded from normal indexing.
- Use filesystem work in `asyncio.to_thread`.
- Use timezone-aware UTC timestamps.
- Prefer `shutil.move` over assumptions about identical mounts.
- Rebuild backlinks and indexes after restore.
- Do not treat `deleted: true` frontmatter as deletion; it would require every
  reader to filter the page.
- Do not use the operating-system Trash because it lacks application metadata,
  retention control, and portable server behavior.

## QA

1. Soft-delete a disposable page and inspect its Markdown and sidecar.
2. Verify it disappears from normal listing, search, and graph.
3. Restore it to the original path and verify indexing.
4. Test destination collision and idempotent repeated deletion.
5. Purge one entry and empty multiple entries with accurate result counts.
6. Run the scheduled purge against an expired fixture.
7. Browser-test Undo, trash listing, restore, and confirmed permanent purge.

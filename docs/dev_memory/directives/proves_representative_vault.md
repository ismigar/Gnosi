# Directive: Build the representative Proves vault

## Objective

Populate the registered `Proves` vault with a deterministic, representative
subset of the registered `Principal` vault for autonomous application testing.
The source remains read-only.

The maintained implementation lives in
`monorepo/apps/gnosi/pipeline/skills/proves_dataset/`.

## Source and destination guards

- Resolve both paths from the management database before execution.
- Require source basename `Principal` and destination basename `Proves`.
- Require source and destination to be sibling directories.
- Refuse a destination that is not empty unless `--allow-existing` is explicit.
- Never delete, rename, truncate, or modify a source file.

## Dataset policy

Copy the lightweight functional directories completely:

- `BD`
- `Wiki`
- `Calendar`
- `.Dashboards`
- `Daily Notes`
- `Drawings`
- `Templates`
- `Newsletters`
- `Imported`
- `Clips`
- `data`

Copy `.gnosi/page_meta` because sidecars are required for realistic page
behaviour. Do not copy `.gnosi/identity.json`, configuration, backups, caches,
agent state, history, trash, secrets, or local databases.

Use deterministic, extension-diverse samples for large directories:

- `Mail`: 40 Markdown records and their matching HTML representation.
- `Assets`: 40 files, maximum 5 MiB each.
- `Images`: 30 files, maximum 2 MiB each.
- `Library`: 20 files, maximum 10 MiB each.
- `Biblioteca`: 12 files, maximum 5 MiB each.

File selection is sorted and round-robin by extension so repeated executions
produce the same set and exercise more formats than taking the first files.

## Verification

After copying:

1. Confirm the source file count and modification fingerprint are unchanged.
2. Confirm `Proves/BD/vault_db_registry.json` exists.
3. Confirm representative files exist in every available sampled category.
4. Record counts, bytes, skipped files, and read errors in
   `Proves/.gnosi/test_dataset_manifest.json`.
5. Query the application with `X-Vault-Id` for `Proves` and verify the vault
   pages endpoint without selecting `Principal`.

## Restrictions and edge cases

- Do not copy all of `Images`, `Assets`, `Mail`, `Library`, or `Biblioteca`; doing so can
  hydrate tens of gigabytes from OneDrive.
- Do not follow symbolic links.
- Skip placeholders or files that fail with `EDEADLK`, `EAGAIN`, or another
  per-file `OSError`, and record the failure in the manifest.
- Do not reuse Principal's local SQLite database; Gnosi owns a separate
  per-vault database keyed by the destination path.

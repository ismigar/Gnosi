# Vault History Orphan Cleanup

## Context

Page and drawing versions live under `.history/<id>/`. Older permanent purges
did not remove history, so directories can remain after their source and trash
entry are gone.

## Procedure

`pipeline/sandbox/cleanup_history_orphans.py` is report-first:

1. Fetch live page IDs and trash IDs from the selected vault.
2. Include live drawing IDs from drawing files.
3. Compare them with history directories.
4. Produce JSON and Markdown reports containing title, latest version time,
   version count, size, and possible live-title match.
5. Request explicit human review.

Deletion requires `--delete --yes`:

1. Refetch current live and trash state.
2. Reverify every candidate.
3. Exclude explicit `--keep` IDs.
4. Create a tar archive outside OneDrive.
5. Delete only the still-orphaned directory.

## Restrictions

- Drawing histories are not listed by the pages endpoint; check drawing files.
- Old history directories may be keyed by title rather than UUID.
- A live page with the same title may indicate an ID migration.
- A trash page remains restorable and its history is not orphaned.
- Reverify after the report because a page may have been restored.
- Resolve each target and prove its parent is exactly `.history`.
- Never delete without an external backup.
- Use timestamps when parseable and filesystem mtime as fallback.
- Avoid scanning huge online-only data without a bounded need.

## QA

Create fixtures for live page, trash page, drawing, title-keyed history,
genuine orphan, and path-containment attack. Verify report classification,
fresh-state recheck, backup contents, keep exclusions, and deletion scope.

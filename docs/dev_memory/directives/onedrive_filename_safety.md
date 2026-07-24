# OneDrive and Windows Filename Safety

**Last updated:** 2026-07-14

## Problem

OneDrive and Windows reject names containing:

- Reserved characters: `< > : " / \ | ? *`
- Control characters `\x00`–`\x1f`
- Leading or trailing spaces
- A trailing period or leading colon
- Windows device names: `CON`, `PRN`, `AUX`, `NUL`, `COM0`–`COM9`, and
  `LPT0`–`LPT9`, with any extension

Every path segment matters; an invalid directory name is as unsafe as an
invalid filename.

## Canonical policy

Never derive a path from external data without a helper from
`backend/utils/safe_io.py`:

- `sanitize_vault_title(title, fallback, max_len)` for a human title.
- `sanitize_rel_folder(path, fallback)` for a relative multi-segment path.
- `sanitize_path_segment(value, fallback)` for one strict segment.
- `sanitize_filename_component(value)` for identifiers such as Message-ID.
- `guard_windows_reserved(name)` for an otherwise sanitized name.

Do not duplicate sanitizers inline. The canonical invalid-character pattern is
`r'[<>:"/\\|?*\x00-\x1f]'`. Message identifiers also remove all whitespace
because folded RFC 5322 headers can contain internal line breaks.

Truncate before final cleanup, then call `rstrip(" .")`; truncating after
cleanup can expose a trailing space or period.

Never rely on `.strip("<>")` for untrusted input. It removes characters only
at the ends and misses folded-header whitespace.

## Historical mail incident

Mail synchronization produced names derived from malformed Message-ID headers.
The value retained an internal `<` after `.strip("<>")`, contaminating both
filenames and frontmatter IDs.

`pipeline/sandbox/migrate_mail_filenames_2026_05_05.py` performs an idempotent,
dry-run-first repair:

1. Find unsafe mail Markdown names.
2. Read the frontmatter ID.
3. Compute a safe ID through `sanitize_filename_component`.
4. Rename Markdown and HTML pairs.
5. Rewrite frontmatter and `mail_message_tags`.

Do not rename these files manually; it can desynchronize the database and make
IMAP import the message again.

## Full-vault migration

`pipeline/sandbox/scan_onedrive_invalid_names.py` scans every path component
for invalid characters, control characters, unsafe whitespace, trailing
periods, and Windows device names. It is dry-run by default and requires
`--apply`; `--yes` skips confirmation.

Properties:

- Imports canonical helpers rather than duplicating them.
- Resolves case-insensitive collisions with ` (2)`, ` (3)`, and so on.
- Renames leaves before parent directories.
- Excludes `.Trash` from mutation and reports it separately.
- Uses `os.scandir` and tolerates `EDEADLK`/`EAGAIN`.

### Link safety

Pages with a frontmatter `id` retain identity when their filename changes.

For a Markdown page without `id` or `title`, the backend uses the stem as
identity. Before renaming, the migration injects the old stem as `id` and
`title`. If online-only content cannot be read, it skips and reports the file.

After renaming, it rewrites literal and percent-encoded path references in
Markdown and JSON, including:

- Asset embeds
- File fields
- Page icon sidecars
- Dashboard configuration

Rewrite full file paths before directory prefixes because ordering affects
matches.

When a directory is renamed, update affected `folder` values in
`BD/vault_db_registry.json` for databases and tables.

Pause OneDrive before `--apply` to prevent synchronization conflicts and stale
copies from another machine. Restart the native backend afterward so its page
index remaps IDs to paths:

```bash
launchctl kickstart -k gui/$UID/com.gnosi.backend-native
```

## Restrictions

- Never use raw `mv` for a migration covered by these scripts.
- Do not delete a `__legacy_dup1` collision automatically; review which copy is
  canonical.
- If the active registry is online-only during an apply run, materialize it
  through the host warmup helper and rerun the idempotent migration.
- Existing user-visible titles may remain multilingual. Filename safety does
  not require translating stored data.
- Sanitization must preserve accents, capitalization, and spaces where the
  target helper promises human-readable names.

## QA

Regression tests in `backend/tests/test_onedrive_filename_safety.py` cover
reserved characters, control characters, whitespace, reserved device names,
path traversal, every folder segment, collision handling, and identity
preservation.

After migration:

1. Rerun the scanner in dry-run mode and expect no actionable paths.
2. Verify registry folder paths.
3. Restart the backend and confirm pages resolve by their original IDs.
4. Confirm OneDrive synchronizes without rename warnings.

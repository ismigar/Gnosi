# Media Upload Path Safety

## Context

The media upload endpoint once accepted unsanitized album and filename values,
allowing traversal outside the Images root. Direct writes were also
non-atomic, which risked truncated files during cloud synchronization.

## Design

1. Album paths legitimately contain nested directories. Split both slash
   styles and sanitize every segment.
2. Reject `.` and `..` segments with HTTP `400`; never silently redirect them.
3. Resolve the final destination and prove it remains inside the Images root
   before creating directories. This also blocks symlink escapes.
4. Keep `sanitize_path_segment` in `backend/utils/safe_io.py` so services do
   not import API modules.
5. Write uploads atomically with `safe_write_bytes`.
6. Resolve collisions with a short content-hash prefix. Identical bytes under
   the same name are harmless.

Treat the uploaded filename as one component. Embedded separators become safe
characters and never create directories.

## Restrictions

- Sanitization is not a replacement for post-resolution containment.
- Never import an API route module from a service.
- Very long names may lose their extension under the current length cap; keep
  this limitation tested and visible.
- Invalidate the media index cache after a successful upload.
- Apply OneDrive and Windows filename rules from
  `onedrive_filename_safety.md`.
- User-visible errors use i18n with English defaults.

## QA

Unit tests cover traversal, mixed separators, symlink escape, reserved names,
atomic interruption, collision handling, identical-content uploads, and cache
invalidation.

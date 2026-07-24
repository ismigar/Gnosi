# Témenos Image Asset Recovery

## Objective

Restore public assets referenced by Drupal HTML or theme CSS when the server no
longer contains the expected file.

## Procedure

1. Identify failing public URLs and confirm their HTTP status.
2. Compare each path with the local Drupal public-files source.
3. Transfer only confirmed missing assets to the exact public path.
4. Verify HTTP responses and visual rendering.

## Restrictions

- Image-style regeneration cannot restore a missing original.
- Never recursively replace the entire public-files directory.
- Restore the original before regenerating derived styles.
- A brand logo may come from theme settings rather than a managed file.
- Do not delete suffixed duplicates merely because hashes match; first migrate
  Drupal field, revision, usage, and crop references.
- Build query condition groups from a query object, not a database connection.
- Audit custom theme CSS for direct `/sites/default/files/` and `public://`
  references in addition to HTML images and managed files.

## 2026-07-23 duplicate audit

The audit found 72 suffix families across 310 files. Most were byte-identical;
six families contained genuinely different content. Maximum safe savings after
retaining each unique payload were approximately 38.5 MB.

Mixed-content families were preserved. One PDF family contained three unique
payloads, each repeated internally.

## Applied consolidation

`pipeline/sandbox/temenos_deduplicate_files.php` is simulation-first and
requires explicit apply mode.

Before apply, a database backup was created outside the public directory.
The operation:

- Redirected field and revision references.
- Transferred usage records.
- Consolidated duplicate focal crops.
- Removed only byte-identical redundant file entities.
- Preserved every distinct payload.
- Removed stale usage and crop records whose targets no longer existed.

Final integrity audit found no missing managed files, orphaned field
references, orphaned usage, duplicate crop groups, or crops with absent file
entities. Representative public pages and canonical downloads returned HTTP
`200` without browser console errors.

## Hero incident

The homepage theme referenced a background image directly from CSS. It was not
a Drupal-managed file and returned `404`, although the original remained in the
local project.

Only that missing file was restored to the exact public path. The duplicate
audit now also reports missing public assets referenced directly by custom
theme files.

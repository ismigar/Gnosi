# User-visible release notes

> ID: GNOSI_USER_VISIBLE_RELEASE_NOTES_2026_08
> Last Update: 2026-08-15
> Status: ACTIVE

## Objective and scope

Maintain one structured, reviewed source of release notes that is visible inside
Gnosi and reused by the public GitHub release. Notes describe user-visible
outcomes rather than commit messages or internal implementation details.

## Source of truth

Release metadata lives in the frontend source so it is bundled with native,
desktop, and self-hosted builds. Entries are ordered newest first and contain a
semantic version, release date, channel, and categorized translation keys.

All user-visible text is stored in the four supported locale catalogs. The
English rendering is used for the public release notes and generated changelog.

## User experience

The Control Center exposes the complete release history beside the application
version. Gnosi also presents the current version notes once after an upgrade and
lets desktop users inspect notes before downloading an available update when
the bundled catalog contains that version.

Every history entry with verified public artifacts links to its versioned
GitHub release so web and self-hosted users can choose the appropriate macOS,
Windows, or Linux artifact. Entries without a `downloadUrl` display a
non-interactive unavailable state instead of deriving a potentially broken URL.

Dismissal is stored locally per version. It must never prevent the permanent
Control Center entry from reopening the history.

## Release workflow

The release-note validator rejects duplicate or unordered versions, missing
required fields, missing locale keys, unsupported categories, and a frontend
version without a matching release entry.

The release workflow renders the English entry for the tag and supplies it to
the public GitHub draft. The committed public changelog is generated from the
same catalog and must remain synchronized.

Before any platform package is built, the official workflow verifies that the
tag version matches the frontend manifest, Electron manifest, monorepo lockfile,
localized catalog, and generated changelog. This keeps invalid metadata from
consuming a complete cross-platform release run.

## Restrictions and edge cases

- Do not generate public notes directly from commits because merge and refactor
  messages are not meaningful to users.
- Do not make network access a requirement for viewing notes; packaged releases
  must retain their own history offline.
- Do not reuse the plugin update list for application releases because those
  have independent versions and installation flows.
- Do not show the first-run dialog for development versions without a matching
  catalog entry.
- Do not add a release version without translations in Catalan, English,
  Spanish, and French.
- Do not link release history to `releases/latest` because older entries must
  keep pointing to their own immutable versioned artifacts.
- Do not derive a release URL from the catalog version because notes can be
  prepared before their tag and public release exist. Add `downloadUrl` only
  after verifying the published release and its artifacts.
- Do not assert the total number of links in the complete release-history
  dialog because verified historical releases legitimately add their own
  links. Scope download-link tests to the article for the release under test.
- Do not validate documentation impact from committed changes alone during a
  local pre-PR run because release documentation may still be staged,
  unstaged, or newly created. The local gate must include all four states.
- Do not compare the generated changelog with platform-specific line endings.
  Git checkouts can materialize Markdown with CRLF on Windows even when its
  content matches the LF rendering. Normalize CRLF and legacy CR to LF for the
  comparison while preserving every other byte-level difference.
- Do not defer rendering the tagged release entry until after packaging. A
  missing catalog version must fail in the metadata preflight before any
  installer build starts.

## Verification checklist

- The release catalog validator passes.
- The committed changelog matches the generated English rendering.
- The changelog comparison passes with LF and CRLF checkouts.
- Frontend i18n, unit tests, lint for changed files, and production build pass.
- The Control Center opens and closes the release history in the native UI.
- The once-per-version dialog does not reopen after dismissal.
- The GitHub release workflow consumes the generated notes file.

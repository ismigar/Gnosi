# User-visible release notes

> ID: GNOSI_USER_VISIBLE_RELEASE_NOTES_2026_08
> Last Update: 2026-08-03
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

Every history entry links to its versioned public GitHub release so web and
self-hosted users can choose the appropriate macOS, Windows, or Linux artifact.

Dismissal is stored locally per version. It must never prevent the permanent
Control Center entry from reopening the history.

## Release workflow

The release-note validator rejects duplicate or unordered versions, missing
required fields, missing locale keys, unsupported categories, and a frontend
version without a matching release entry.

The release workflow renders the English entry for the tag and supplies it to
the public GitHub draft. The committed public changelog is generated from the
same catalog and must remain synchronized.

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

## Verification checklist

- The release catalog validator passes.
- The committed changelog matches the generated English rendering.
- Frontend i18n, unit tests, lint for changed files, and production build pass.
- The Control Center opens and closes the release history in the native UI.
- The once-per-version dialog does not reopen after dismissal.
- The GitHub release workflow consumes the generated notes file.

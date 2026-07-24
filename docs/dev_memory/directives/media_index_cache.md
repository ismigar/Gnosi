# Filesystem-First Media Manager

> ID: `media-manager-filesystem-first-2026-05`
> Status: active

## Scope

This directive records:

- Finder-first bulk file management.
- Unified MediaCenter header and sidebar behavior.
- Settings modal wheel-scroll repair.
- The rule that generated caches stay outside OneDrive.

## Finder-first policy

Finder is the source of truth for bulk add, delete, rename, move, and folder
operations on desktop. MediaCenter focuses on browsing, search, metadata, and
presentation.

The single-file upload control was removed because its destination was
ambiguous and it contradicted the bulk workflow. The backend upload endpoint
remains for future mobile or remote use.

Any future upload UI requires a multi-file drop zone, an explicit active album,
and a clearly displayed destination.

## Existing indexing

Retain the current `os.scandir` media cache, persistent local cache, lazy media
tree, and provider warmup behavior. Do not duplicate them with a second SQLite
index unless a new measured requirement justifies it.

## UI consistency

MediaCenter uses `AppHeader`, compact controls, existing design tokens, and the
standard sidebar toggle.

The collapsible sidebar wrapper requires `min-width: 0`; otherwise flexbox
content prevents width collapse. Keep the inner aside at its fixed layout
width, while the wrapper animates to zero.

All labels route through i18n and default to English.

## Settings modal wheel behavior

Native form controls can consume wheel events without scrolling themselves or
their parent.

While settings are open, a capture-phase non-passive listener redirects wheel
delta from select, input, or non-scrollable textarea controls to the
`.settings-main` container. A textarea with its own overflow retains native
scrolling. Remove the listener when the modal closes.

## Cache location

Generated indexes, caches, and local databases belong under configured local
data or a host cache directory, never inside OneDrive.

Reasons:

- Cloud synchronization can corrupt SQLite through conflict copies.
- Regenerable data wastes bandwidth.
- Synchronization mtime changes can trigger false reindexing.

Semantic user metadata is not a cache and may belong in the vault under its own
atomic sidecar policy.

## QA

1. Frontend build passes.
2. Browser verifies unified header, sidebar animation, persistent reopening,
   and responsive layout.
3. Wheel events over every native control scroll the correct container.
4. Scrollable textareas retain internal scrolling.
5. Media cache path resolves outside the synchronized vault.

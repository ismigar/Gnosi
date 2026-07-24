# Wikilink Interactions

> ID: `WIKILINK-INT-2026-05-04`
> Status: active

## Behavior

| Action | Result |
|---|---|
| Click | Replace the active app tab. |
| Command/Ctrl+Click | Open a new app tab. |
| Shift+Click | Open a parallel pane. |
| Hover for at least 450 ms | Show a page preview. |
| Right-click | Show all opening choices. |

The context menu closes on Escape, outside click, or scroll. Hover remains open
while the pointer enters its popup.

## Architecture

`VaultDashboard` provides current-tab, new-tab, and parallel-pane handlers
through editor context. Each `WikilinkInline` resolves its target, dispatches
modifier behavior, and owns its hover and menu state.

Hover and context-menu UI render through body portals.

Embedded contexts may expose fewer handlers. Degrade to an available opening
mode rather than making the link inert.

## Preview API

`GET /api/vault/pages/{page_id}/preview` returns ID, title, a short sanitized
excerpt, icon, and cover.

The endpoint:

- Reuses canonical page lookup and frontmatter parsing.
- Strips code, HTML, Markdown formatting, links, headings, lists, quotes, and
  rules from the excerpt.
- Combines short paragraphs up to the limit.
- Does not calculate expensive virtual fields.
- Degrades cloud read failure to an empty preview rather than a page failure.

## Cache

Use a module-level preview cache so it survives individual wikilink remounts:

- Maximum 100 entries.
- Five-minute TTL.
- FIFO eviction.

Stale previews within the TTL are acceptable. A future page-save event may
invalidate them.

## ProseMirror interaction

ProseMirror handles mouse-down before React click. Stop propagation and
immediate propagation on mouse-down and mouse-up, then navigate on click or
auxiliary click.

Do not add `contentEditable={false}` to the wikilink span; some browsers then
treat it as an atomic node and suppress React interaction.

## Target resolution

1. Remove a section suffix before backend lookup.
2. Use a UUID target directly.
3. Otherwise perform a trimmed, case-insensitive reverse title lookup.
4. If unresolved, send the original target and expose the expected not-found
   state.

## Restrictions

- Keep the hover delay to avoid network requests during ordinary pointer
  movement.
- Never return an entire page body for a tooltip.
- App tabs are not browser windows; do not use `window.open`.
- A UUID link returning `404` may indicate that the target page lost its
  frontmatter ID. Repair the ID through the page guard and reindex.
- All menu and preview text uses i18n with English defaults.

## QA

Build the frontend, test the preview API, and browser-test all modifiers, hover
delay, popup retention, menu dismissal, unresolved targets, embedded fallbacks,
and keyboard accessibility.

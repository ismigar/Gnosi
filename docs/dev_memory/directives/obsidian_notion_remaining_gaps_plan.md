# Remaining Obsidian and Notion Gaps

> Status: planning record from 2026-06-24. Daily notes, group subtotals, the
> tags page, and comments were already implemented. This plan covers the four
> remaining gaps.

## Recommended sequence

| Order | Feature | Value | Effort | Risk |
|---|---|---:|---:|---:|
| 1 | External sharing | High | Medium | Medium |
| 2 | Independent infinite canvas | Medium | Medium | Low |
| 3 | Real-time collaboration | High | High | High |
| 4 | Plugin system | Medium | High | Medium |

Sharing and canvas are relatively self-contained. CRDT collaboration should
wait for dedicated concurrency capacity. Plugins benefit from stable extension
points.

## External sharing

Current organization auth already supports workspace roles and vault access,
but invitations create memberships directly and there is no anonymous or
page-level sharing.

Add a `ShareLink` model with opaque token, page, workspace, creator,
permission, expiry, revocation state, and timestamps.

Required API:

- Create and list shares for a page.
- Revoke a token without deleting its audit record.
- Resolve `/s/{token}` without workspace membership.
- Validate expiry, revocation, permission, and rate limits.

The public resolver must be isolated from the vault router's global workspace
dependency and must never expose adjacent pages.

The frontend needs a sharing modal for active links, permission selection,
clipboard copy, revocation, and email invitations. `/s/:token` renders a
minimal read-only page; comment permission may reuse `PageComments`.

Email invitations require a registration token and membership creation only
after the invited address completes registration.

QA includes revoked and expired tokens, read-only mutation denial, anonymous
data containment, and a full external-browser flow.

## Real-time collaboration

The existing WebSocket route provides presence and generic relay only. Editing
still sends the complete Markdown document over HTTP with an etag.

Use Yjs with BlockNote:

1. Authorize the WebSocket against page and workspace access.
2. Relay Yjs updates and keep a snapshot for late joiners.
3. Bind BlockNote to Yjs in organization mode.
4. Persist a quiescent document back to Markdown.
5. Add awareness-based cursors and selections.

Markdown remains canonical at rest. Yjs exists only during concurrent editing;
do not store `.ydoc` files in the vault. Personal mode and connection failure
retain HTTP autosave.

QA uses two authenticated browser contexts editing the same page and verifies
convergence without `409` conflicts, late-joiner state, cursor visibility, and
final Markdown persistence.

## Independent infinite canvas

Tldraw snapshots already persist under `Drawings/`, and dragging a vault page
creates a note shape. The missing behavior is a live page card.

Implement a custom Tldraw page-card shape with:

- Page title and cached body preview.
- An Open action that routes to the page.
- Refresh when the page title changes.
- An action to create and embed a new page at the canvas location.
- Optional arrows as visual-only relationships.

Do not turn arrows into vault relationships unless an explicit later feature
defines bidirectional synchronization.

QA creates a canvas, adds several pages, updates a title, opens a card, reloads
the drawing, and checks performance with many cards.

## Plugin system

Existing extension points include editor blocks, slash-menu actions, agent/MCP
tools, and integrations. Version 1 is an internal declarative registry, not an
arbitrary third-party code marketplace.

A frontend plugin manifest may declare:

```text
id, name, blockSpecs, slashItems, sidebarItems, settingsPanel
```

Move existing blocks and slash actions into the registry without changing
behavior. Persist enabled plugin IDs in `.gnosi/plugins.json` through atomic,
locked `GET/PUT /api/vault/plugins` operations. Present tools and integrations
under the same settings concept where appropriate.

Third-party execution requires a future sandbox such as an iframe protocol or
WASM and is explicitly outside version 1.

QA covers every existing editor block, slash command, enable/disable state,
reload persistence, and destructive confirmation accessibility.

## Common implementation protocol

- Use a focused branch from current `main`.
- Keep new portable state under `.gnosi/` with atomic writes and locks.
- Do not place non-portable Yjs state in the vault.
- Run isolated backend E2E tests against a temporary vault and local-data
  directory.
- Run the frontend production build and browser QA.
- Use `ConfirmModal` for revoking or deleting user-managed resources.
- Preserve English as the default interface language while routing every
  user-visible string through i18n.

# AI-Assisted Social Publishing

> Status: phase 0 implemented on 2026-06-09; browser E2E was pending in the
> original branch. Architecture: hybrid workflow with both vault-record and
> free-composer entry points.

## Objective

Add a “Publish to Social Media” action that uses AI to propose
network-specific copy. The user reviews, edits, or regenerates each proposal
before real publication. Every attempt persists as a row in the Social
Publications vault table.

Phase 0 targets Mastodon and Bluesky. Later phases may add LinkedIn, Facebook,
Instagram, and X.

## Principles

- Separate `compose` from `publish`; proposal generation has no side effects.
- Require human approval before publication.
- Persist schedule and history in the vault, never in process-memory arrays.
- Treat networks as row data, not one schema column per provider.
- A failure on one network must not discard other results or the audit record.

## Existing capabilities

- Mastodon and Bluesky text publishing clients.
- Social network and stream configuration.
- Feed reading and interaction actions.
- APScheduler.
- Keychain-backed credentials.
- AI provider fallback.

The old `/api/social/post` depended on removed n8n behavior and returned `501`.
Scheduled posts and history were volatile arrays. Phase 0 replaces both paths.

## Flow

```text
Vault record or free text
        |
        v
PublishSocialModal
  1. Select active networks
  2. Generate proposals
  3. Edit or regenerate per network
  4. Publish now or schedule
        |
        v
Network clients + Social Publications row
```

## Components

- `PublishSocialModal.jsx`: selection, editable cards, regeneration, publish,
  and schedule.
- `VaultTable.jsx`: per-row action enabled by `social_publish_enabled`.
- `SchemaConfigModal.jsx`: table capability toggle.
- `social_routes.py`: compose, publish, schedule, history, and processing.
- `social_compose.py`: network-specific prompts and AI calls.
- `social_clients.py`: publisher registry and media-aware interfaces.
- `social_store.py`: durable vault records.
- Scheduler task: process due social posts every one to five minutes.

## API contracts

```text
POST /api/social/compose
  input: source text/title/url/page, networks, optional hint
  output: proposal text, hashtags, length, limit status, provider

POST /api/social/publish
  input: approved posts by network, optional source page
  output: record ID and per-network status, URL, or error

POST /api/social/schedule
  input: approved posts, scheduled time, optional source page
  output: record ID and scheduled time

GET /api/social/scheduled
GET /api/social/history
POST /api/social/process-scheduled
```

The scheduler calls the processing endpoint or shared service; the implementation
must not depend on a browser session.

## Social Publications schema

Use stable, provider-independent fields:

- Title
- Source page ID and source URL
- Networks
- Approved messages as structured data
- Status
- Scheduled, published, created, and updated timestamps
- Per-network result URLs and errors

Safe initial column types are acceptable, but persisted structure must remain
forward-compatible with later rich field promotion.

## AI composition

Prompts adapt tone, character limits, hashtags, link handling, and language to
each network. The default output language follows the source content unless
the user explicitly chooses another language. English remains the application
default, not a forced translation of user content.

Regenerating one network must not alter approved proposals for other networks.
Always return character count and an over-limit flag.

## Credentials and media

Mastodon and Bluesky credentials come from configured secrets or environment
settings. An unconfigured network returns a per-network error while the record
still persists.

Client interfaces accept `publish(text, media)`. Automatic resolution of
compound vault image fields was deferred beyond phase 0; text-only publishing
must continue to work.

## Implementation record

Phase 0 added `social_compose.py`, `social_store.py`, and
`PublishSocialModal.jsx`, and updated clients, routes, scheduler, vault table,
schema settings, and social dashboard.

Static frontend build and Python compilation passed in the original branch.
Runtime composition must be tested through the app because
`call_ai_with_fallback` resolves its model configuration from request context;
an isolated Python process may have no model URL.

## QA gates

1. Compose proposals for Mastodon and Bluesky from a vault record.
2. Edit one proposal and regenerate only the other.
3. Publish with real test accounts and verify returned URLs.
4. Verify the durable Social Publications row after backend restart.
5. Schedule a post a few minutes ahead and confirm automatic publication.
6. Test partial provider failure and over-limit handling.
7. Complete browser QA for both the row action and free composer.

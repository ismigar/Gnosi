---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/domains/notebooks
  - backend/services/notebook_service.py
  - backend/api/notebook_routes.py
  - backend/domains/agent/routes/checkpoints.py
  - backend/domains/agent/routes/shared.py
  - backend/services/durable_job_worker.py
  - backend/agent/agent_context.py
  - backend/agent/factory.py
  - backend/api/agent_routes.py
  - frontend/src/features/notebooks
  - frontend/src/shared/api/notebooks.ts
  - frontend/src/features/agent
tests:
  - backend/tests/test_pr6_domain_facades.py
  - backend/tests/test_notebook_service.py
  - backend/tests/test_notebook_agent_context.py
  - frontend/src/features/notebooks/create/NotebookCreateDialog.test.tsx
  - frontend/src/features/notebooks/NotebooksPage.test.tsx
  - frontend/src/features/notebooks/detail/NotebookDetail.behavior.test.tsx
  - frontend/src/features/notebooks/public-entry.test.ts
  - frontend/src/app/composition.contract.test.ts
  - frontend/src/features/notebooks/model/notebookTableActions.test.ts
  - tests/e2e/tests/e2e/notebooks.spec.ts
---

# Grounded notebooks

## Responsibility

`backend/domains/notebooks/` now owns repository access, catalog and resource
selection, ingestion, evidence, analysis, chat, and state. The historical
service remains a compatibility facade for the unchanged API and worker calls.

Grounded notebooks provide a dedicated `/notebooks` workspace for asking
questions about the attachments and URLs held by selected records in the
configured References table. They combine a searchable notebook library, a
paginated source panel, settings, and the same streaming chat transport used by
the floating assistant.

The embedded conversation imports the agent feature's public `AgentChat` export,
never its private session or stream modules. The application shell loads that
same public entry dynamically. Both consumers use the complete typed props
contract, including immutable context references, notebook identity, and read-only
mode. Only the outgoing HTTP payload receives a mutable array copy; reference
contents, source selection, storage keys, and authorization remain unchanged.

The record body, title, tags, and other metadata are not evidence. Gnosi reads
record metadata only to locate values in fields whose table schema is an
attachment/file or URL type. A notebook never edits or deletes its source
record, attachment, or original URL.

The first release does not provide audio summaries, Studio, generated notes,
or source editing.

## Actors and access

| Actor | Private notebook | Workspace notebook |
| --- | --- | --- |
| Creator | Discover, read, converse, manage sources and settings | Discover, read, converse, manage sources and settings |
| Workspace editor | Not discoverable | Discover, read, converse |
| Workspace viewer | Not discoverable | Discover and read the transcript and sources |

Every request is also scoped to the active Vault and workspace. Private access
does not implicitly extend to administrators in a different user principal.
Only the creator can change membership, settings, or delete the notebook.

## Source and revision flow

```mermaid
flowchart LR
    Selection["Configured References table\nselected record IDs"] --> Fields["Attachment and URL\nfields only"]
    Fields --> Fingerprint["Record and source\nfingerprints"]
    Fingerprint --> Queue["Durable notebook\ningestion job"]
    Queue --> Extract["Existing secure\nextractors"]
    Extract --> Draft["Inactive SQLite\nrevision"]
    Draft --> Index["FTS5 and deterministic\nlocal vectors"]
    Index --> Switch["Atomic active-revision\nswitch"]
    Switch --> Tools["Read-only notebook\ntools"]
    Tools --> Chat["Grounded answer\nwith citations"]
```

Notebook creation stores the References table identity that was active at that
time. Later creation and source additions use the currently configured table,
while an existing notebook remains attached to its original table.

Opening a notebook, asking a notebook-backed question, or requesting a manual
refresh compares current source values with the active revision. Repeated
triggers are coalesced by the durable job queue. Unchanged sources reuse their
chunks; changed sources are re-extracted. An incomplete revision is never made
visible. After the first successful revision, chat continues against the last
complete revision while a refresh runs.

URL sources are revalidated only after
`GNOSI_NOTEBOOK_URL_REFRESH_TTL_SECONDS` (six hours by default). Gnosi sends
persisted ETag and Last-Modified validators through the same SSRF-safe,
redirect-validating downloader and falls back to a bounded response-content
hash when a server does not provide validators. An unchanged check records an
audit outcome but does not activate a new evidence revision.

YouTube, Vimeo, and other supported streaming adapters use a metadata-only
provider probe after the same TTL. Gnosi compares a deterministic fingerprint
of the media identity, duration, timestamps, live state, and size metadata; it
downloads and transcribes the media again only when that fingerprint changes.
A per-Resource retry bypasses reuse for the selected Resource while copying all
non-target evidence from the active revision.

Removing a Resource deletes notebook membership immediately. Retrieval and
whole-notebook analysis join against current membership, so removed evidence is
excluded before a replacement revision is ready.
Resource catalog and refresh adapters read the canonical Vault page, table, and
reference owners directly. They do not call through the dynamic HTTP
compatibility facade, keeping domain dependency direction explicit.

## Persistence and recovery

Notebook state is instance-local under `LOCAL_DATA/system/notebooks.sqlite3`.
The repository contains notebook definitions, ACL entries, resource membership,
revisions, sources, chunks, FTS5 rows, durable analyses, and the conversation
principals created by each mode. Rows are scoped by a hash of the Vault path and
the workspace identifier.

The durable worker registers `notebook_ingest` and `notebook_analysis` handlers.
Queued or expired leased jobs resume after process restart. Revision activation
is transactional. If a previously indexed source fails to refresh, its last
valid representation remains available with `stale` status; a new failed
source is reported and excluded.
Analysis admission resolves a concrete active Vault before enqueueing the job;
missing request context fails before a durable payload can contain an ambiguous
or machine-dependent path.

New revisions are retention-eligible. Cleanup preserves the active revision,
the configured recent completed and audit windows, every revision pinned by a
conversation, and every revision used by a durable analysis. Revisions created
before this policy remain conservatively protected. The default windows are
three completed revisions and twenty audit outcomes, configurable with
`GNOSI_NOTEBOOK_COMPLETED_REVISION_RETENTION` and
`GNOSI_NOTEBOOK_AUDIT_REVISION_RETENTION`.

Attachments use the existing materialization, OneDrive warm-up, path
containment, size limits, document extraction, OCR, and media extraction
boundaries. Web retrieval keeps SSRF protection, validates every redirect, and
treats page content as untrusted data rather than model instructions.

## Retrieval, analysis, and citations

The conversation toolbar lets a user select exact attachment or URL sources
from the current notebook and attach other accessible notebooks. Selecting
another notebook contributes all of its available sources. The current notebook
continues to own the shared or private checkpoint namespace; attached notebooks
are read-only evidence and never merge their conversation histories.

Each chat turn pins every selected notebook to a positive, completed revision
on the server. Client source IDs are validated against that immutable revision,
current Resource membership, source status, Vault, workspace, and notebook ACL.
The same source boundary is applied to inspection, hybrid search, exact evidence
reads, and durable analysis. The
notebook workflow exposes only these contextual operations:

- inspect bounded source metadata;
- search notebook chunks with FTS5 and the existing deterministic local vector;
- read exact evidence by stable chunk identifier;
- start, inspect, and read a durable hierarchical analysis over the pinned
  revision.

Source-dependent questions must perform a real notebook search before the
model can synthesize an answer. The workflow does not receive Vault mutation,
MCP, skill mutation, or external-action tools. Hierarchical analysis maps over
bounded evidence batches and reduces their summaries instead of placing
hundreds of sources in one prompt.

Citations carry the notebook Resource, revision, source, chunk, and locator.
Every grounded claim in notebook chat is mapped from its server-validated
`chunk_id` to a visible source link. Attachment evidence uses the `gnosi-cite`
navigation contract and the authorized pinned-revision evidence endpoint so the
reader opens the exact attachment, page or fragment even after a later refresh.
Legacy attachment links are upgraded when read, so existing notebooks gain the
same navigation without forced reindexing. Web evidence links to the original
validated URL.

## Conversation namespaces

Private-per-member mode derives one checkpoint principal per user. Shared mode
derives one authorized notebook principal and serializes concurrent turns with
the existing thread lock. Shared messages include their author and the history
is append-only; only the creator can clear it. Changing modes does not merge
histories: returning to a previous mode restores that namespace.

Notebook deletion enumerates all registered derived principals and deletes
their checkpoint threads before cascading notebook indexes, revisions, and
analysis rows. Original Vault data is outside this deletion boundary.

Notebook HTTP routes are strictly typed and consume public checkpoint helpers
from the Agent domain instead of private compatibility-facade symbols. Missing
active Vault or checkpoint storage now fails explicitly; transcript deletion
and reads retain the same isolated thread identifiers and frozen OpenAPI
responses.

## HTTP contracts

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /api/notebooks` | Paginated library and creation from Resource IDs |
| `GET/PATCH/DELETE /api/notebooks/{id}` | Detail, settings, and derived-data deletion |
| `GET /api/notebooks/resources` | Alphabetical paginated selector with type, author, and tag facets from the configured References table |
| `GET/POST /api/notebooks/{id}/sources` | Inspect or add Resource membership |
| `GET /api/notebooks/{id}/chat-sources` | Authorized source and notebook choices for the conversation context |
| `DELETE /api/notebooks/{id}/sources/{resource_id}` | Exclude one Resource immediately |
| `POST /api/notebooks/{id}/sources/{resource_id}/refresh` | Retry only one Resource while reusing non-target evidence |
| `POST /api/notebooks/{id}/refresh` | Coalesced explicit notebook refresh |
| `POST /api/notebooks/{id}/refresh/cancel` | Cooperatively cancel the active ingestion job |
| `GET /api/notebooks/{id}/evidence/{chunk_id}?revision={revision}` | Resolve one authorized citation against its immutable notebook revision |
| `GET /api/notebooks/{id}/conversation` | Canonical active-mode transcript |
| `POST /api/chat` | Streaming conversation with an authorized notebook context |

Notebook-backed chat ignores client attempts to choose the revision,
checkpoint principal, or session namespace. The server derives all three after
authorization. It accepts up to sixteen authorized notebook contexts, keeps the
page notebook as the conversation owner, and rejects non-notebook context,
attachments, mentions, and skill overrides.

## User interface behavior

The strictly typed `frontend/src/features/notebooks/` domain owns the library,
detail panels, resource selectors, creation dialog, styles, and their tests.
Application composition consumes its public `index.ts` entry only. The page
and creation dialog retain independent lazy imports, so opening one does not
eagerly load the other. Domain internals use direct local imports; shared HTTP
adapters retain the existing canonical Vault-scoped contracts. This ownership
change does not alter routes, source selection, polling, or conversation state.

The multi-select action appears only when the open table identity equals the
configured References table identity. It is never enabled by a fixed name or
ID. The creation dialog accepts a title, visibility, conversation mode, and up
to one thousand selected Resource IDs. Creation and add-source selectors sort
the full matching catalog accent-insensitively before pagination and expose
schema-derived type, author, and tag filters. Filter metadata is selection-only
and never enters notebook evidence. Pages marked as table templates are
excluded by the selector, request validation, and ingestion snapshots.
Records with no attachment or public HTTP URL values are also excluded; the
selector reports how many were omitted instead of offering an unusable choice.

Desktop layout shows sources, embedded chat, and settings together. Mobile
layout presents the same panels as tabs. The UI polls only the visible active
notebook: ingestion progress uses a short interval while a job is active, and
the transcript uses a bounded interval for collaborative updates. Inactive
notebooks are not polled.

Active progress identifies the Resource currently being processed and offers
the creator a cancellation action. Each Resource reports its last successful
check and bounded error reason; failed individual sources expose their own
reason. Retry controls call the per-Resource contract and are disabled while a
different ingestion revision is active.

Workspace viewers receive the canonical transcript in a visibly read-only
chat without composer, retry, edit, or rewind actions. Only editors can send a
turn, and only the creator sees manual refresh and other management controls.

## Failure behavior and operations

The first conversation stays blocked until at least one source exists in a
complete active revision. Per-Resource and per-source states expose `pending`,
`indexing`, `available`, `stale`, and `error`; manual refresh provides retry.
Errors do not replace a complete active revision.

Cancellation is cooperative: the queue moves to a durable `cancelled` state,
the worker checks it before every Resource and before activation, and any
in-flight Resource transaction rolls back. The last complete revision stays
available; cancelling the first ingestion leaves chat blocked with a visible
error until a new refresh succeeds.

Operators can inspect the notebook SQLite repository and durable job queue
below `LOCAL_DATA`, but must not move either into a shared Vault. Backend code
reloads in native development, but dependency changes require updating the locked
environment and restarting the backend process. Restart its LaunchAgent only
when that optional macOS arrangement is used. The same configuration-derived
paths are used in native and Docker deployments.

## Verification boundaries

Unit coverage proves source-field exclusion, incremental reuse, immediate
membership removal, citation identity, ACL isolation, checkpoint namespaces,
positive revision validation, read-only notebook tools, and durable pinned
analysis. It also exercises PDF, URL, OCR, large-chunk, expired-lease recovery,
conditional web validation, and a 300-Resource ingestion job. Frontend and
Playwright coverage prove read-only permissions, omitted empty Resources, the
configured-table bulk action, selectors, grounded chat, a navigable citation,
and automatic source refresh.
Release verification also requires a clean backend start, frontend build, and
desktop plus mobile browser flow.

Current load limits are one thousand Resources per create/add request, two
hundred selector rows per page, fifty retrieval results, and bounded analysis
batches. Notebook configuration and derived indexes are local to one Gnosi
instance and are not synchronized across installations.

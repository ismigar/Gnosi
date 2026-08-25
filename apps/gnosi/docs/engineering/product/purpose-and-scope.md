---
status: implemented
last_verified: 2026-08-02
source_paths:
  - ARCHITECTURE.md
  - CONTRIBUTING.md
tests: []
---

# Purpose and scope

## Product objective

Gnosi turns a user-controlled folder of Markdown into a connected workspace
without making an opaque hosted database the owner of the user's knowledge. It
combines the portability of files with higher-level application behavior:
structured views, editing, search, graph traversal, references, communication,
automation, publishing, and AI assistance.

The primary engineering goal is data sovereignty with useful collaboration and
automation. Users must be able to inspect, back up, synchronize, and recover
their knowledge independently of Gnosi.

## Design principles

### Local-first persistence

Markdown and YAML front matter are the primary representation for knowledge.
Indexes and caches accelerate access but must be rebuildable. Relational
databases store application state that does not belong naturally in a note,
such as identities, memberships, message indexes, and execution history.

### Personal mode without account overhead

The default `personal` mode can run as a local single-user application without
a login screen. `org` mode enables authenticated multi-user behavior,
workspaces, roles, and access checks. Security-sensitive deployments may force
authentication even while retaining personal-mode semantics.

### Portable deployment

Core code must operate natively and in Docker. Deployment detection may select
appropriate defaults, but domain code must not assume Docker-only hostnames or
native-only absolute paths.

### Explicit external effects

Opening files, sending messages, publishing content, deleting data, invoking
generated tools, and calling remote services cross trust boundaries. These
operations use scoped services and, where applicable, role checks or explicit
confirmation policies.

### Graceful degradation

Optional providers and integrations must fail locally. A missing AI provider,
translation sidecar, mail account, or cloud-file hydration service must not
make unrelated vault operations unavailable.

## Product surfaces

- Knowledge: Markdown pages, block editing, attachments, views, search, graph.
- Research: references, CSL citations, PDF/EPUB reading, annotations, feeds.
- Communication: mail, calendars, meetings, contacts.
- Intelligence: model registry, agents, MCP tools, runtime skills, context sources.
- Automation: scheduled tasks, formulas, rollups, reminders, publishing.
- Integration: Google, Microsoft, Notion, Drupal, social networks, office add-ins.
- Distribution: native web runtime, Docker self-hosting, Electron desktop app,
  and browser/office companion clients.

## Non-goals and boundaries

- Gnosi does not require a proprietary cloud database as the source of truth.
- Derived indexes are not durable substitutes for the vault.
- Real-time collaboration currently provides a relay/presence foundation; it is
  not documented as complete CRDT editing until that behavior is implemented.
- Vendored Zotero reader code is not owned Gnosi application logic. Gnosi owns
  the build, integration boundary, local changes, and data flows around it.
- A feature proposal in a directive is not shipped behavior until verified in
  source and tests.

## Licensing consequence

Gnosi is AGPL-3.0-or-later. Modified versions offered over a network must make
their corresponding source available under the same license. Contributors must
keep source, technical documentation, and operational instructions suitable for
third-party review.

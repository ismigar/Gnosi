---
status: implemented
last_verified: 2026-08-02
source_paths:
  - backend/api/vault_routes.py
  - backend/config/paths_config.py
  - backend/data/management_db.py
tests:
  - backend/tests/test_safe_io.py
  - backend/tests/test_e2e_etag_concurrency.py
---

# ADR 0001: Markdown Vault as the knowledge source of truth

- Status: Accepted
- Decision date: 2026-08-02 (formalized from existing architecture)

## Context

Gnosi needs structured editing, search, graph traversal, collaboration, and
automation while preserving user ownership and interoperability. Making an
application database the only representation would create lock-in and make
ordinary file backup, synchronization, and external editing secondary.

## Decision

User knowledge is stored as Markdown, YAML front matter, and assets inside a
user-controlled Vault. Relational databases store application state that is not
the authored knowledge representation. Indexes and caches derived from Vault
content are rebuildable.

## Consequences

- Files remain inspectable and portable without Gnosi.
- Writes require atomicity, ETags, identity normalization, and index refresh.
- External editors and cloud providers introduce concurrency and availability
  failures that services must tolerate.
- Database-style views are projections over files, so typed evaluation and
  registry consistency are application responsibilities.
- SQLite and secrets remain local-only because they have different durability
  and synchronization semantics.

## Rejected alternatives

- SQL as the only knowledge store: stronger transactions but loss of portable
  file ownership.
- Cloud SaaS as the mandatory source: easier centralized collaboration but
  incompatible with local-first sovereignty.
- Treating synchronized SQLite as portable storage: unsafe because file sync
  does not provide database locking or atomic replication.

## Verification impact

Tests cover Markdown round trips, atomic writes, ETag conflicts, identifier and
link behavior, index rebuilds, path containment, provider failures, and local
data isolation.

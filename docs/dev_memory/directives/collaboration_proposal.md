# Vault Collaboration: Architecture Proposal

> ID: `COLLAB-PROPOSAL-20260528`
> Status: proposal, not implemented.
> Related: `gnosi_native_reference_manager.md`, `environment_integrity.md`.

## Purpose

Gnosi is currently a personal, local-first vault. This directive records why
collaboration is not a small feature, compares the viable architectures, and
provides a starting recommendation. It does not authorize implementation.

## Why collaboration is absent today

- A vault is a directory on disk, commonly synchronized by OneDrive.
- Cloud storage, not Gnosi, propagates filesystem changes.
- The backend treats every request as coming from the vault owner.
- Markdown, frontmatter, registry files, sidecars, indexes, and annotations are
  local to each installation.

This is intentional: it provides data ownership, privacy, offline access, and
minimal infrastructure. Collaboration necessarily trades against some of
those properties.

## Option A: shared cloud directory with conflict resolution

Two or more users point Gnosi at the same shared cloud directory. The storage
provider synchronizes files, while Gnosi detects and resolves concurrent edits.

Advantages:

- No new server infrastructure.
- The vault remains a regular directory.
- Data stays with the cloud provider users already selected.
- It covers the common coauthor or supervisor workflow.

Limitations:

- Simultaneous edits can produce conflicted copies.
- There is no native real-time presence or field-level history.
- Shared-folder permissions and setup remain provider-specific.

Estimated effort: one to two weeks for a usable first version.

Suitable for stable teams of fewer than five people whose edits are usually
not simultaneous.

## Option B: centralized authenticated server

A multi-tenant server owns personal and shared libraries. Clients become
presentation layers over server-hosted data.

Advantages:

- Field-level conflict resolution, presence, and granular permissions.
- A familiar Notion- or Zotero-style collaboration model.

Limitations:

- Breaks the “vault on your disk” principle.
- Introduces hosting, database, backup, monitoring, scaling, security, and
  GDPR obligations.
- Requires substantial changes because current endpoints assume a local
  filesystem.

Estimated effort: three to six months of full-time work, potentially including
a Yjs, OT, or equivalent synchronization layer.

This option makes sense only as a deliberate product and business transition.

## Option C: peer-to-peer CRDT synchronization

Devices synchronize directly through WebRTC or a similar channel, with a
lightweight signaling service. Documents use a CRDT such as Yjs or Automerge.

Advantages:

- Offline concurrent edits converge without a central content server.
- Data can remain encrypted between peers.

Limitations:

- CRDT integration is complex in an existing file-based system.
- The CRDT becomes canonical and Markdown becomes a projection.
- Signaling still creates an infrastructure dependency.
- Most of the editor and backend synchronization model must be redesigned.

Estimated effort: six to twelve months. Treat this as a research fork, not the
main product direction.

## Recommendation

For a coauthor or supervisor sharing a research library, choose option A. It
provides most practical value without abandoning the local-first architecture.

For a SaaS collaboration platform, choose option B only after an explicit
business decision and a full security and operations plan.

Use option C only for an experimental CRDT research project.

## Prerequisites for option A

1. Extend `expected_etag` conflict checks to every write endpoint, including
   page creation, reference import, bulk metadata updates, Zotero promotion,
   and sidecar writes.
2. Add a conflict-resolution modal with local and remote versions, frontmatter
   field diffs, body block diffs, and local/remote/manual merge choices.
3. Optionally add a lightweight heartbeat that warns when another client is
   editing the same page.
4. Document shared-cloud setup, simultaneous-edit behavior, and conflict
   recovery for end users.
5. Add Playwright coverage with two browser contexts editing the same document.

Estimated first-version effort: five to eight days.

## Restrictions and edge cases

- PDF annotations currently live in SQLite. A cloud filesystem cannot safely
  merge this database; use explicit export/import or JSON sidecars.
- The registry is global per vault. Concurrent schema edits require conflict
  handling or a proposal-and-merge workflow.
- Metadata sidecars need the same optimistic concurrency guarantees as
  Markdown files.
- A heartbeat fingerprint is advisory identity, not authorization.
- Do not imply that cloud sharing provides real-time collaboration or
  permission enforcement.

## Learning record

| Date | Learning | Resolution |
|---|---|---|
| 2026-05-28 | “Add collaboration” has no single technical meaning. | Separate filesystem, centralized, and peer-to-peer models, then select by use case. |

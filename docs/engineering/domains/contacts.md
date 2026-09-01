---
status: implemented
last_verified: 2026-08-28
source_paths:
  - backend/api/contacts_routes.py
  - backend/models/contact.py
  - backend/services/contacts_service.py
  - backend/services/contacts_sync_engine.py
  - backend/services/google_contacts_service.py
  - frontend/src/features/contacts
tests:
  - frontend/src/features/contacts/components/ContactList.test.tsx
  - frontend/src/features/contacts/components/ContactForm.test.tsx
  - frontend/src/features/contacts/public-entry.test.ts
  - backend/tests/test_contacts_sync_merge.py
  - backend/tests/test_google_contacts_service.py
  - backend/tests/test_carddav_vcard_unfold.py
  - backend/tests/test_vcard_escaping.py
  - tests/e2e/tests/e2e/contacts.spec.ts
---

# Contacts

## Responsibility

Contacts provides a local normalized address book over manual records and
connected Google, CardDAV, and compatible sources. It supplies search and
recipient/attendee autocomplete to Mail and Calendar.

The strictly typed `features/contacts/` frontend owns the address-book page,
integration catalog, list, detail, and form components. Application composition
consumes its public lazy entry; shared API adapters remain independent of the
screen. Relocation preserves source identity, contact fields and synchronization
behavior without retaining duplicate components at their former paths.

The HTTP routes and synchronization provider boundary are strictly typed.
Integration credentials are validated before a Google or CardDAV provider is
constructed, and heterogeneous synchronization counters and errors keep an
explicit result contract without changing the public payload.

## Data model

A contact has stable local identity, workspace, type, display name, primary
email and phone, organization fields, notes, structured multi-value emails,
phones and addresses, provider identifiers, source, photo, tags, timestamps,
and synchronization state.
The SQLAlchemy model uses `Mapped[]` declarations for every column and its
workspace relationship, so service, route and synchronization assignments are
checked against the persisted schema. Pydantic request/response models retain
their historical defaults and byte-stable OpenAPI representation.

Provider-specific payloads are normalized before merge. vCard processing
unfolds continuation lines, decodes values, and escapes separators without
changing user data.

## Synchronization and merge

```mermaid
flowchart LR
    Remote["Provider contacts"] --> Normalize["Normalize names and values"]
    Local["Local contacts"] --> Match["Stable provider id or normalized identity"]
    Normalize --> Match
    Match --> Merge["Field-aware merge"]
    Merge --> Persist["Workspace-scoped local rows"]
    Persist --> Status["Sync counts and errors"]
```

The critical merge rule is preservation of local-only enrichment. A remote sync
may update provider-owned values but must not blank tags, notes, manually added
values, or another provider's identity merely because the current payload omits
them. Deletion policy is provider-specific and not inferred from a partial list.

## Cross-domain use

Mail searches contacts for recipients and entity linking. Calendar searches
contacts for attendees. These consumers receive normalized display data and do
not access provider credentials or raw synchronization payloads.

## Invariants

- Every query and mutation is workspace-scoped.
- Remote identifiers are namespaced by provider/source.
- Repeated syncs do not create duplicates for the same provider record.
- Local enrichment survives provider refresh.
- Multi-value fields preserve type labels and preferred values.
- Contact deletion and remote deletion are separate effects unless an explicit
  bidirectional policy is selected.

## Verification focus

Run merge, vCard unfold/escape, provider normalization, case-insensitive email,
and workspace tests. Playwright verifies list, detail, create/edit, search, and
cross-navigation without depending on a real provider account.

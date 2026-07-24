# Directive: Contacts synchronization

> ID: CONTACTS_SYNC_001
> Status: ACTIVE

## Objective

Provide bidirectional contact synchronization with Google Contacts and an
extensible provider design for CardDAV, Outlook, and other services. Gnosi
supports contact CRUD and shows synchronization state.

## Data and API

Contact records store a workspace ID, type, name, email, phone, company, job
title, address, notes, remote resource name, last synchronization time,
source, and tags.

The API exposes contact list, detail, create, update, delete, synchronization,
and synchronization-status endpoints under `/api/contacts`.

Google OAuth credentials belong in integration storage and the secret store,
never documentation or committed configuration.

## Synchronization

- Gnosi-to-remote creates or updates the People API record, saves its resource
  name, and updates `last_synced_at`.
- Remote-to-Gnosi lists provider contacts, creates unknown resource names, and
  merges existing records.
- Use remote resource identity rather than email as the durable merge key once
  available.

## Critical merge rule

**Pull is a merge, never a mirror. A missing or empty remote field must not
erase a non-empty local field.**

Both Google and CardDAV parsers commonly return missing scalar fields as an
explicit empty string. Therefore `parsed.get(key, existing_value)` is unsafe:
the key exists and bypasses the default.

For `name`, `email`, `phone`, `company`, `job_title`, `address`, `notes`, and
`photo_url`, use:

```python
parsed.get(key) or existing_value
```

This preserves local content for both `""` and `None`, while a non-empty
remote value still wins.

The known tradeoff is that clearing a field remotely resurrects the local
value on the next sync. Supporting deletion requires a per-contact
last-synchronized baseline and a three-way merge. Prefer this limitation over
silent data loss on both sides.

Timestamp gating can reduce writes but does not replace field-level merge
safety. A newer remote record can still omit a field.

Regression coverage lives in
`backend/tests/test_contacts_sync_merge.py`.

## Restrictions

- Use workspace context rather than a hard-coded user ID.
- Register OAuth routes in the active FastAPI application.
- Keep provider-specific parsing behind a common contacts service.
- Treat remote failures per account and do not corrupt local contacts.

## QA

- Backend contact merge tests pass.
- Native backend starts with OAuth routes registered.
- Frontend build passes.
- Creating locally appears remotely; editing remotely appears locally without
  clearing unrelated local-only fields.

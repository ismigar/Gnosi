# Directive: Mail tagging system

## Objective
Implement a local, Gnosi-native email tagging system that is independent of
the provider (Gmail, IMAP, or Microsoft). Store tags in the Vault database.

## Architecture

### Models (vault DB via `get_db`)
- `MailTag`: id (uuid), name, color (hex, e.g. `#3b82f6`), created_at
- `MailMessageTag`: message_id (PK), tag_id (FK → MailTag, ondelete CASCADE) (PK), account_email, subject, sender, date_str
  - Cached metadata lets the UI display tagged messages without calling Gmail
    or IMAP again.

### Endpoints `/api/mail/tags`
- `GET /api/mail/tags` → list all tags.
- `POST /api/mail/tags` → create a tag with `{name, color}`.
- `PUT /api/mail/tags/{id}` → update `{name?, color?}`.
- `DELETE /api/mail/tags/{id}` → delete a tag and cascade to `MailMessageTag`.
- `GET /api/mail/messages/{id}/tags` → return `[tag_id, ...]`.
- `POST /api/mail/messages/{id}/tags` → replace all message tags with
  `{tag_ids: [], metadata: {...}}`.
- `GET /api/mail/tags/{tag_id}/messages` → return tagged messages with cached
  metadata.
- `POST /api/mail/tags/messages/batch` → `{message_ids: []}` → `{message_id: [tag_id, ...]}`

### Frontend
- `hooks/useMailTags.js` → CRUD and assignment.
- `components/Mail/MailTagPicker.jsx` → selection menu with inline creation.
- `MailSidebar.jsx` → "Tags" section with tag filtering.
- `MailList.jsx` → colored pills on items and an `activeTagId` prop.
- `MailViewer.jsx`: Tag button in the action bar and active-tag display.

## Restrictions
- Tags are local to Gnosi and do not synchronize with Gmail labels or IMAP
  flags.
- The `mail_message_tags` table stores cached subject, sender, and date
  metadata for tag filtering.
- Color is a hexadecimal string (`#RRGGBB`).
- The UI allows at most 20 tags per account; the database does not enforce
  this limit.
- A message can have multiple tags.
- `POST /messages/{id}/tags` performs a full replacement, not a merge.

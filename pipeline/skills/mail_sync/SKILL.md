---
name: mail-sync
description: Maintain Gnosi's Gmail and IMAP synchronization into vault notes, preserving message identity, metadata and HTML companions. Use for mail sync or persistence regressions, not real account operations without authorization.
---

# SKILL: Mail Sync

This skill is responsible for synchronizing emails (via IMAP or API) to the Gnosi Vault, converting them into Markdown notes with structured metadata.

> ID: MAIL-SYNC-20260408
> Entry point: `backend/domains/mail/routes/messages.py`
> Status: ACTIVE

---

## 1. Current entry points

`POST /api/mail/sync` dispatches configured accounts through the integration
manager. IMAP accounts use `backend/services/imap_mail_sync_service.py`; other
supported accounts use the Gmail service in
`backend/services/vault_mail_sync_service.py`. Blocking provider I/O runs outside
the async event loop. Preserve the distinction between an empty sync and a
failed IMAP connection, including the existing failure response.

There is no standalone `sync_mail.py`. The old `imap_to_md.py` was retired after
consumer review and private historical preservation; it is not a current sync
entry point. Do not execute it against real accounts or migrate its duplicate
files as an incidental test. The source cleanup does not delete existing mail.

## 2. Metadata Requirements (Crucial)
For a mail note to appear correctly in the Vault UI tables, it **MUST CONTAIN** the `database_table_id` field in the frontmatter.

- **Table ID**: `mail` (check `vault_db_registry.json` if it changes).
- **Consequence**: Without this ID, the note will be a "ghost" (it will exist on disk but not in the UI table).

---

## 3. File Generation (Technical Protocol)

### Robust YAML Frontmatter
Emails contain special characters (quotes, emojis, symbols) that invalidate YAML if generated manually with strings.

- **GOLDEN RULE**: Always use the Python `yaml` library (`yaml.dump`) to generate the frontmatter.
- **Implementation**:
  ```python
  import yaml
  metadata = {
      "database_table_id": "mail",
      "sender": sender_email,
      "subject": subject_text,
      "date": formatted_date
  }
  frontmatter = "---\n" + yaml.dump(metadata) + "---\n"
  ```

### Configuration Management
- Use explicit `backend.*` imports or relative package imports, not a generic `config` module or parent-directory discovery.
- Resolve the active vault and credentials through existing backend services. Process variables precede local Gnosi configuration and an explicitly selected shared environment file. Never write shared credentials from this tool.

---

## 4. Verification

Do not assume a universal `since_id`: Gmail message IDs and IMAP folder/UID
identity have different persistence rules. Preserve each adapter's existing
deduplication, folders, read/starred state, metadata and HTML companion behavior.

Use fake provider responses and a disposable vault. Test repeated syncs,
malformed MIME/encoding, quotes and Unicode in YAML, empty mailboxes and failed
connections. Verify the resulting notes through the backend data engine and the
mail UI. Actual account access is a separate user-authorized operation, never
part of documentation generation or ordinary unit tests.

---

## 5. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-04-08 | Empty / Ghost Tables | Missing `database_table_id` | Documented as a mandatory requirement in `SKILL.md`. |
| 2026-04-08 | Invalid YAML | Failed manual escaping | Mandatory use of `yaml.dump`. |

---
*Maintenance: Provider support belongs in the backend adapters and integration
manager. Do not create a second mail pipeline or revive the removed script.*

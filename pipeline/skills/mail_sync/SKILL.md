# SKILL: Mail Sync

This skill is responsible for synchronizing emails (via IMAP or API) to the Gnosi Vault, converting them into Markdown notes with structured metadata.

> ID: MAIL-SYNC-20260408
> Associated Script: `pipeline/skills/mail_sync/scripts/sync_mail.py`
> Status: ACTIVE

---

## 1. Metadata Requirements (Crucial)
For a mail note to appear correctly in the Vault UI tables, it **MUST CONTAIN** the `database_table_id` field in the frontmatter.

- **Table ID**: `mail` (check `vault_db_registry.json` if it changes).
- **Consequence**: Without this ID, the note will be a "ghost" (it will exist on disk but not in the UI table).

---

## 2. File Generation (Technical Protocol)

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
- Avoid import collisions with `config`. Always use absolute monorepo imports or relative imports within the skill package.

---

## 3. Workflow (Algorithm)
1. **Fetch**: Connect to the mail server and download new messages based on the saved `since_id`.
2. **Parsing**: Extract title, body (HTML to Markdown), and metadata.
3. **Escaping**: Process metadata via `yaml.dump`.
4. **Persistence**: Write to the corresponding Vault folder (defined in `paths_config.py`).
5. **Verification**: Validate that the note is visible via the backend data engine.

---

## 4. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-04-08 | Empty / Ghost Tables | Missing `database_table_id` | Documented as a mandatory requirement in `SKILL.md`. |
| 2026-04-08 | Invalid YAML | Failed manual escaping | Mandatory use of `yaml.dump`. |

---
*Maintenance: If new mail providers are added (Gmail API), the `MailConnector` class in the synchronization script must be updated.*

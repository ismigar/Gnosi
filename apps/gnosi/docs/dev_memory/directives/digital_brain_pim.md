# Directive: Digital Brain PIM (Calendar & Mail)

## Description
This directive outlines the architecture for integrating an alternative to Notion Calendar and Notion Mail natively within the Digital Brain, entirely backed by local Markdown files in the Vault.

## Core Principles

### 1. Unified Storage (Everything is Markdown)
- Both Calendar events and Mail messages are treated as `.md` files residing in specific Vault directories (e.g., `/Vault/Calendar` and `/Vault/Mail`).
- Advantages: Global search, bidirectional linking (`[[note]]`), tagging, and integration with the existing `VaultTable` / Dashboard components.

### 2. Calendar Integration
- **Ingestion**: The system must be able to read external calendars (Google Calendar, Apple Calendar, etc.) via `.ics` subscriptions.
- **Processing**: A background worker (via `SchedulerManager` or `n8n`) periodically fetches these `.ics` feeds and generates/updates read-only Markdown files (`readonly: true`, `source: external_url`) in the Vault.
- **Native Mac Notifications/Reminders**: To ensure the user never misses an event, the Digital Brain will expose its own unified `.ics` feed endpoint (`/api/calendar.ics`). The user's Mac/iPhone Calendar app will subscribe to this feed, allowing the native Apple OS to handle pop-ups and notifications reliably. Alternatively, an n8n workflow can push impending events to a Telegram bot.
- **Frontend**: A dedicated React route (`/calendar`) that fetches `.md` files containing Date frontmatter and renders them in a calendar grid (e.g., FullCalendar).

### 3. Mail Integration (via IMAP)
- **Protocol**: IMAP is the chosen protocol over POP3. This allows bidirectional synchronization (e.g., marking an email as read or archiving it in the Vaul will optionally sync back to the IMAP server) and folder management.
- **Ingestion**: A background script connects via IMAP (Gmail, custom domain, etc.), downloads unread/recent emails, and saves them as Markdown in `/Vault/Inbox`.
- **Structure**: 
  - Frontmatter: `from`, `to`, `subject`, `date`, `thread_id`, `status: unread`.
  - Body: (Optional) AI-generated summary at the top, followed by the actual email body.
- **Workflow**: Emails can be easily converted into tasks by changing their `status` frontmatter or moving them to the `/Vault/Tasques` folder.

## Restrictions & Edge Cases
- **IMAP Connections**: Standard IMAP for major providers (like Gmail) often requires "App Passwords" or OAuth2. This must be managed securely via `.env_shared`.
- **.ics Parsing**: Parsing `.ics` files can be tricky with recurring events (RRULEs). The Python daemon must safely expand these recurrences for a reasonable future window (e.g., 6 months) when creating Markdown files, or the frontend must handle recurrence logic natively.
- **File Name Collisions**: Emails with the same subject or events with the same title must be safely sanitized and suffixed to avoid overwriting files in the Vault.

## Interactions with other systems
- **n8n vs SchedulerManager**: Evaluate whether the IMAP polling is better suited for an n8n trigger (which has built-in IMAP nodes) or a pure Python script in the `SchedulerManager`. For now, Python is preferred for fine-grained Markdown generation, though n8n is simpler for pure triggering.

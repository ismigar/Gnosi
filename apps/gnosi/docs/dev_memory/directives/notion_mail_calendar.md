# Directive: Notion Mail & Calendar Ecosystem

## Description
This directive defines the architectural standards and implementation protocols for the "Notion-style" Mail and Calendar integration within Gnosi. The goal is to create a seamless, minimalist wrapper over Google Workspace that treats emails and events as rich database objects.

## Core Principles

### 1. The Wrapper Philosophy
- **Synchronized, not Stored**: Unlike previous iterations that converted everything to Markdown, this system acts as a real-time wrapper over the Gmail/Calendar APIs.
- **Minimalist UX**: Remove Gmail's visual noise. Focus on speed and cognitive ease.

### 2. Email as a Database Object
- Each email thread can have custom Gnosi properties: Status, Priority, Summary, Category, etc.
- These properties are stored locally in the Gnosi Vault/Database, linked by `thread_id` or `message_id`.

### 3. Deep Integration (Mail + Calendar)
- **Insert Availability**: The composer must allow dragging time slots from a calendar view to generate a one-time scheduling link.
- **Unified Context**: Mentions (`@`) and Slash commands (`/`) allow linking any part of the Digital Brain into communications.

## Technical Specifications

### Google Workspace Integration
- Use Gmail API (Modify/Read) and Calendar API via OAuth 2.0.
- Handle Rate Limiting and Token Refreshing gracefully.
- **Selective Sync**: Labels created in Gnosi sync to Gmail. Reverse sync of labels is only done on initial connection.

### Local Storage Requirements
- **Drafts & Scheduled**: Must be stored locally (AWS/Gnosi Infra) due to API limitations for cross-platform sync.
- **Metadata**: Custom properties (Select, Status, etc.) are stored in the local database, keyed by Google's IDs.

### UI/UX Standards
- **Peek Modes**: Side Peek, Center Peek, Full Page.
- **Block Editor**: Use the internal BlockNote-based editor for the email composer.
- **AI Layer**: Natural language auto-labeling with a sampling/validation step.

## Restrictions & Edge Cases
- **Draft Sync**: No bi-directional sync for drafts with Gmail.
- **Deleted Items**: Individual email deletion within a thread in Gmail is NOT reflected in Gnosi; only full thread deletion is captured.
- **Blocked/Snoozed**: These states are NOT synchronized with Google.

## Verification Protocol
- **Sync Integrity**: Verify that labels created in Gnosi appear in Gmail.
- **Availability Flow**: Test the full loop from "Insert Availability" to event creation.
- **AI Accuracy**: Use the sampling UI to confirm AI classification before applying to the whole inbox.

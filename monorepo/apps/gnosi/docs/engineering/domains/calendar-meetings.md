---
status: implemented
last_verified: 2026-08-09
source_paths:
  - backend/api/calendar_routes.py
  - backend/api/meeting_routes.py
  - backend/models/calendar.py
  - backend/services/google_calendar_service.py
  - backend/services/hybrid_calendar_service.py
  - frontend/src/pages/CalendarPage.jsx
  - frontend/src/components/Vault/CalendarSidebarRight.jsx
  - frontend/src/components/Vault/DigitalBrainCalendar.jsx
  - frontend/src/utils/calendarUtils.js
  - frontend/src/components/MeetingRecorder.jsx
  - frontend/src/components/MeetingReminderWatcher.jsx
tests:
  - backend/tests/test_calendar_path_containment.py
  - backend/tests/test_google_calendar_event_updates.py
  - backend/tests/test_meeting_reminders_race.py
  - frontend/src/utils/calendarUtils.test.js
  - e2e/tests/e2e/calendar.spec.ts
---

# Calendar and meetings

## Responsibility

Calendar aggregates local Vault events with connected Google Calendar and
CalDAV accounts. It supports calendar selection, event CRUD, invitations,
RSVPs, free/busy queries, geocoding, reminders, hidden-event state, ICS export,
meeting recording, transcription, and AI-generated notes.

## Event aggregation

The route layer resolves workspace context and selected integrations, then
normalizes provider events and local Markdown events into a shared response.
Provider identifiers remain paired with their account/calendar origin; an ID
alone is not globally unique enough for mutation.

Hidden events are local overlay records. Hiding does not delete a provider
event. Unhide removes the overlay so the next aggregation includes it again.

## Mutation flow

```mermaid
sequenceDiagram
    participant UI as Calendar UI
    participant API as Calendar routes
    participant Resolver as Integration resolver
    participant Provider as Google or CalDAV
    participant Vault as Local event page
    UI->>API: Create, patch, delete, RSVP, or invite
    API->>Resolver: Resolve account and enforce editor role
    alt Remote event
        Resolver->>Provider: Provider-specific operation
        Provider-->>API: Normalized event or error
    else Vault event
        Resolver->>Vault: Contained Markdown operation
        Vault-->>API: Updated local event
    end
    API-->>UI: Unified response
```

Google all-day events use an exclusive end date, while the Gnosi form presents
an inclusive last day. Conversion happens exactly once at the provider
boundary: requests add one day before writing to Google, and responses remove
one day before rendering. A birthday occurrence is patched through its
recurring master; dates owned by Google Contacts remain provider-controlled,
while supported fields such as the title can still be updated.

## Reminders and meeting notes

Reminder settings select lead time and behavior. Collection merges upcoming
events and deduplicates concurrent requests so duplicate reminders are not
created. The frontend watcher displays active reminders and can navigate to the
calendar or dismiss them.

Meeting recording uploads bounded audio to a background workflow. Status polling
separates recording, transcription, summarization, note creation, completion,
and failure. Generated notes are written through Vault-safe operations and
retain event/source context.

## Invariants

- Provider event identity includes account and calendar context.
- Provider-exclusive all-day ends never leak into the inclusive UI model.
- Contact-owned birthday dates are preserved when patching recurring events.
- Calendar writes require an editor-capable context.
- Path-based local events remain inside the active vault.
- Hiding is local and reversible; deletion uses the authoritative provider.
- Reminders are race-safe and do not duplicate for the same event/window.
- Missing transcription or AI providers fail the meeting job, not the calendar.
- ICS output uses normalized time zones and does not expose private credentials.

## Verification focus

Test local path containment, event normalization, recurrence, hidden state,
reminder races, account selection, time zones, and Playwright create/edit/delete
flows. Meeting QA should record or upload a fixture, observe background status,
and verify the resulting Vault page.

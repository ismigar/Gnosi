# Directive: Hide Calendar Events (Privacy/Filter)

## Objective
Allow the user to hide calendar events (both Notion events and external Google Calendar events discovered through Gmail) without removing them from the original source.

## Components to Modify

### 1. Backend: Data Model
- Create `backend/models/calendar.py` with model `HiddenEvent`.
- Table: `hidden_events`
- Fields: `event_id` (String, PK), `user_id` (String, optional), `hidden_at` (DateTime).

### 2. Backend: API
- **Global filter:** Modify `_get_pages_snapshot` (`vault_routes.py`) and `get_events` (`calendar_routes.py`) to load the hidden ID list and discard matching events.
- **New endpoints:**
    - `POST /api/calendar/events/{event_id}/hide`: Add an ID to the hidden list.
    - `POST /api/calendar/events/{event_id}/unhide`: Remove an ID from the hidden list.

### 3. Frontend: Interface
- **Context menu:** Add the "Hide" option to `CalendarContextMenu.jsx`.
- **Filter logic:** Ensure the calendar refreshes after hiding an event.

## Restrictions
- External events should be hidden only locally in Gnosi.
- Do not modify the source event in Google Calendar or Notion by default; update only the local state in `gnosi.db`.

## QA
- Verify that a hidden Google Calendar event disappears from Gnosi but remains in Google Calendar.
- Verify that a hidden Notion event disappears from Gnosi but remains in Notion.
- Verify that hiding can be reversed, optionally through a "Trash" or "Hidden" view.

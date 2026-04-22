# Directive: Smart Entity Extraction from Mail

## Goal
Implement a feature to detect and extract calendar events and contacts from emails using AI, allowing users to quickly add them to their digital brain.

## Backend Implementation
- **Endpoint**: `POST /api/mail/ai/extract_entities`
- **Logic**:
    1. Receive `context` (email body).
    2. Prompt AI to extract:
        - **Events**: `title`, `start` (ISO), `end` (ISO), `location`, `description`.
        - **Contacts**: `name`, `email`, `phone`, `company`, `notes`.
    3. Return structured JSON.
- **Service**: Use `pipeline.ai_client.call_ai_with_fallback`.

## Frontend Implementation
- **Component**: `MailViewer.jsx`
- **Interaction**:
    1. Add a "Smart Scan" button in the action bar or near the header.
    2. When clicked, show a loading state and call the backend.
    3. Display results in a "Smart Actions" banner/card.
    4. **Events**:
        - Show details.
        - Button "Add to Calendar".
        - Prompt for calendar selection (fetch calendars from `/api/calendar/calendars`).
    5. **Contacts**:
        - Show details.
        - Button "Add to Contacts".
        - Call `POST /api/contacts`.

## UI/UX
- Use premium aesthetics: glassmorphism, subtle animations.
- Icon: `Sparkles` or `Brain`.
- Toast notifications for success/error.

## Constraints
- Do not perform extraction automatically on every mail if body is huge (cost/latency).
- Ensure JSON parsing from AI response is robust.

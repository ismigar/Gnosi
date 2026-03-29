# Directive: Social Media Dashboard

## Objective
Develop a unified interface to manage social media accounts (Hootsuite style) within the Digital Brain ecosystem.

## Integration Architecture

### Frontend -> Backend
- **Endpoint:** `POST /api/social/post`
- **Payload:** `{ "content": "string", "networks": ["twitter", "linkedin"] }`

### Backend -> n8n
- **Method:** Webhook
- **URL:** `http://host.docker.internal:5678/webhook/social-post-v2` (accessible from Docker)
- **Payload:** Forwarded from frontend + timestamp.

### n8n Workflow
- **ID:** `social-poster` (or similar)
- **Trigger:** Webhook (`POST /social-post-v2`)
- **Credentials:** stored in n8n (IDs in `.env.shared`).

## Constraints & Standards
1.  **Frontend:** Use existing `monorepo/apps/digital-brain/frontend`. (React + Vite).
2.  **Backend:** Use existing `monorepo/apps/digital-brain/backend` (FastAPI).
3.  **Styling:** Use Vanilla CSS (per global rules) or existing project UI library if available.
4.  **State Management:** Keep it simple (Context API or local state) unless complexity demands Redux/Zustand.

## Data Structure
- **Posts:** Normalized format to render consistently across networks.
  ```json
  {
    "id": "123",
    "network": "twitter",
    "author": "@username",
    "content": "Hello world",
    "timestamp": "2023-10-27T10:00:00Z"
  }
  ```

## Implementation Steps
1.  Create `frontend/src/pages/SocialDashboard.jsx`.
2.  Create `frontend/src/components/social/` directory.
3.  Implement `Column` and `Card` components.
4.  Implement Backend endpoints in `backend/app/routers/social.py`.

## Integrity Checks
- Ensure API keys are NEVER hardcoded. Use `.env`.
- Handle rate limits gracefully (display UI errors).

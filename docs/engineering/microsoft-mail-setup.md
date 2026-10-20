---
status: implemented
last_verified: 2026-10-16
source_paths:
  - backend/api/microsoft_auth_routes.py
  - backend/services/auth_public_surface.py
  - backend/services/microsoft_mail_service.py
  - backend/services/microsoft_calendar_service.py
  - backend/tests/test_microsoft_calendar_service.py
  - backend/tests/test_calendar_oauth_account_preservation.py
  - desktop/microsoft-sign-in.js
  - desktop/main.js
  - frontend/src/shared/api/microsoft-auth.ts
  - frontend/src/features/settings/global-settings/accountProviders.ts
tests:
  - backend/tests/test_microsoft_auth_routes.py
  - backend/tests/test_auth_public_surface.py
  - desktop/microsoft-sign-in.test.js
  - frontend/src/shared/api/microsoft-auth.test.ts
---

# Microsoft mail in Gnosi desktop

Gnosi needs its own Microsoft Entra application registration before starting
Microsoft sign-in. An email address or university password is not an application
registration. Do not borrow another application's client ID.

For a desktop installation, register Gnosi as a **Mobile and desktop application**
with this redirect URI:

`http://localhost:5002/api/auth/microsoft/desktop/callback`

If the desktop backend selects another free port, its default callback uses that
port. Microsoft's native localhost redirect matching ignores the port. A custom
`MICROSOFT_OAUTH_REDIRECT_URI` takes precedence and must reach the running backend.

Use an account audience that includes the intended users. A registration owned by
another organization must support organizational accounts from other directories
to allow UNED students. Supporting personal Microsoft accounts as well requires
the corresponding organizational-and-personal audience.

Set `MICROSOFT_OAUTH_CLIENT_ID` to that registration's Application (client) ID,
using the secure `microsoft_oauth_client_id` setting or the backend environment.
Leave `MICROSOFT_OAUTH_CLIENT_SECRET` unset for the native desktop registration.
The authorization code flow uses PKCE (S256), a one-time state and a ten-minute
expiry. Existing confidential web registrations can continue supplying a secret.

The requested delegated permissions are Microsoft Graph `User.Read`,
`Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, and `offline_access`. The institution
may require administrator approval. Never substitute application permissions or
grant organization-wide consent to bypass that requirement.

The UNED domains `alumno.uned.es` and `uned.es` select Microsoft automatically.
The email travels as `login_hint`; Microsoft performs federation discovery and
redirects to the institution. Desktop sign-in opens the system browser while
preserving Gnosi's Settings window. On completion, the browser invites the user
to return to Gnosi.

Verify a real login only after registering the application: start from Gnosi,
complete the institution's authentication, then verify that the account appears
and can read mail. Local mocked tests do not establish that a registration or
institutional consent exists.

Reference: https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow

## Read-only Microsoft calendars

Calendar settings now start a separate Microsoft authorization with delegated
`Calendars.Read`, `User.Read`, and `offline_access`. Mail permissions and mail
accounts are unchanged. The native public-client registration above is reused;
institutional consent policy can still require an administrator's approval.

Calendar credentials are stored separately in `calendars` using secure-store
references. Reconnecting or refreshing one identity preserves other calendar
entries, including entries without IDs, and all mail/contact configuration.

The connector reads calendar lists and paginated `calendarView` ranges, including
recurring occurrences. Events are read-only: Microsoft calendars cannot be
selected as new-event destinations, and provider mutation endpoints reject them.
It does not import, overwrite, remove or reconcile existing Vault calendar files.
A web Outlook login alone does not grant Gnosi calendar access; the dedicated
calendar consent must succeed before live discovery is available.

References: [calendarView](https://learn.microsoft.com/en-us/graph/api/calendar-list-calendarview?view=graph-rest-1.0)
and [calendar lists](https://learn.microsoft.com/en-us/graph/api/user-list-calendars?view=graph-rest-1.0).

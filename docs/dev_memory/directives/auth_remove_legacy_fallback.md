# Directive: removing the `ismael-legacy` auth fallback

## The problem

`get_user_id_or_legacy` (`backend/services/auth_service.py`) resolves the caller
as JWT → `X-User-ID` header → the hardcoded string `"ismael-legacy"`. In
`personal` mode `get_workspace_context` then returns `role="owner"`
unconditionally. Together these mean **any request that reaches the port gets
full owner access**; `require_role("editor")` and friends are no-ops.

Exposure differs by deployment:

| Mode | Bind | Reachable by |
|---|---|---|
| Native (dev Mac) | `127.0.0.1` | local only — the vector is CSRF from a visited web page |
| Docker self-host | `0.0.0.0:5002` (`docker-compose.yml`) | the whole LAN, unauthenticated |

CORS does not help: a `multipart/form-data` POST is a CORS *simple request*, so
the browser sends it without preflight and only the *response* is blocked. With
no credential required, `SameSite` protects nothing either.

## Why it could not simply be switched off

`ismael-legacy` is not a placeholder — on a real install it is the **only** user
row, owning the sole membership, the `Principal` vault and all PATs. Removing
the fallback without giving that account credentials first locks the operator
out of their own vault.

And credentials could not be set at all: **passlib 1.7.4 + bcrypt ≥ 4.1 is
broken**. passlib reads `bcrypt.__about__.__version__`, removed in 4.1, and then
rejects every password as "longer than 72 bytes". `/register` and `/login` were
dead code on any modern install, which is *why* the fallback was still
load-bearing. `verify_password` swallowed the same exception as "does not
match", so it looked like bad credentials rather than a broken dependency.

## Phases

- **0 — Backup.** Snapshot `local_data/system/management.sqlite` via SQLite's
  backup API (not `cp`, which can catch a torn write). Losing it means losing
  the mapping from user to workspace to vault.
- **1 — A real identity (done).** Replace passlib with a direct `bcrypt` call,
  and add `POST /api/auth/bootstrap-credentials`, which sets email + password on
  the *context* user (not matched by email, so the placeholder
  `user@example.com` is not frozen in) exactly once, refusing afterwards. The
  account keeps its `id`, so memberships, vaults and PATs need no migration.
  **Nothing breaks yet — the fallback is untouched.**
- **2 — Public surface (done).** `backend/services/auth_public_surface.py`
  enumerates what may stay unauthenticated: liveness probes, the auth endpoints
  themselves, and endpoints carrying their own credential (share tokens, PAT).
  Method-aware: `GET /api/config` is a watchdog probe, `POST /api/config`
  writes. Defined and tested, **not yet enforced**.
- **3 — Migrate non-browser clients to PAT.** They currently send no credential
  and rely on the fallback: the LibreOffice macro
  (`integrations/libreoffice-cite/gnosi_cite.py`), the Word add-in
  (`frontend/public/word-addin/taskpane.js`), `pipeline/utils/rewalk_subpage_parents.py`,
  `pipeline/skills/notion_clone/scripts/backfill_notion_views.py`, the E2E test
  helpers, and the `curl` recipe in the scheduler SKILL. The watchdogs need no
  change — they only hit allowlisted probes.
- **4 — Flip, reversibly.** Gate the removal behind `GNOSI_REQUIRE_AUTH`,
  defaulting to **off**. With it on, `get_user_id_or_legacy` returns 401 instead
  of the legacy id. Verify the whole app, then change the default, then delete
  the fallback.

## Restrictions / edge cases

- **Do not** claim the legacy account through `/register`: it matches on email,
  so it would permanently freeze `user@example.com`. Use
  `bootstrap-credentials`, which resolves the user from the request context.
- **Do not** exempt a path wholesale in the public surface. `POST /api/config`
  writes settings while `GET` is a probe, and a `/api/public/*` wildcard would
  have exempted anything later dropped under that prefix — enumerate instead.
- **Do not** truncate over-long passwords to fit bcrypt's 72-**byte** limit:
  truncation lets a different password open the same account. Reject, and
  validate in the payload so the user gets a field error rather than a 500. The
  limit is on UTF-8 bytes, so accented passwords hit it before 72 characters.
- **Before phase 4**, confirm `frontend/src/context/AuthContext.jsx` renders the
  login screen on a 401 rather than breaking. Otherwise flipping the flag leaves
  a blank UI.
- Phase 4 does not fix the Docker `0.0.0.0` bind. Requiring auth makes it far
  less dangerous, but binding to loopback by default is a separate decision.

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
  and give the legacy account credentials with
  `pipeline/scripts/set_user_password.py`, run locally. The account keeps its
  `id`, so memberships, vaults and PATs need no migration.
  **Nothing breaks yet — the fallback is untouched.**

  This started as an HTTP endpoint (`POST /api/auth/bootstrap-credentials`) that
  resolved the account from the request context. **That was an account-takeover
  hole and was removed**; the reasoning is preserved here because the design is
  tempting enough to be reinvented. `get_workspace_context` derives the user from
  the `X-User-ID` header, which the caller controls, so an unauthenticated
  request could set its own email and password on any password-less account —
  `ismael-legacy` (a default published in this repo), or any invited/OAuth user
  who has not registered. Reproduced end to end: 200, victim's email replaced,
  attacker's password installed, valid session cookie issued. CORS is
  `allow_origins=["*"]` / `allow_headers=["*"]` and the call needs no
  credentials, so a malicious page could drive it cross-origin — turning
  transient CSRF into durable credentials that would *survive* this very
  migration. A local script needs filesystem access to the management DB and so
  has no remote attack surface.
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
  `pipeline/scripts/set_user_password.py`.
- **Do not** add an HTTP endpoint that sets credentials on the account resolved
  from the request — see phase 1. Anything derived from `X-User-ID` is
  caller-controlled and therefore not an identity.
- **Do not** let `/register`'s claim flow reach the auto-provisioned account.
  Removing the endpoint above was not enough on its own: the placeholder address
  (`PLACEHOLDER_EMAIL`, identical on every install and published in this repo)
  made the same takeover available through `/register` with no knowledge at all —
  verified as 201 + session cookie before the guard was added. The claim flow is
  for INVITED users, where an admin deliberately entered a real address.
  **Still open by design:** an attacker who knows a colleague's address can claim
  their invited account before they register. Closing that needs an invite token,
  which is a separate piece of work.
- **Normalize every email on read and write** with
  `auth_service.normalize_email`. The unique index is case-sensitive, so a path
  that skips it (the invite flow did) creates a duplicate row that the
  case-insensitive lookups then resolve by row order. There is still no
  functional unique index on `lower(email)`, so uniqueness is a convention the
  write paths must keep, not something the schema enforces.
## Phases 3 and 4 — what was actually built

**Enforcement is one app-wide dependency, not per-route gating.** The original
plan was to make `get_user_id_or_legacy` raise. Measuring first showed why that
was not enough: **50 routes never touch `get_workspace_context`** (schedulers,
tools, AI settings, integrations, system, analytics), so they would have stayed
open, and every future endpoint would have been open until someone remembered to
gate it. `enforce_authentication` is registered on the FastAPI app, so the
default is closed and being public is what you have to write down. That makes
`auth_public_surface.PUBLIC_RULES` the enforcement itself rather than a document.

**An allowlist entry is necessary but not sufficient.** It only bypasses the
app-wide gate; a router with its own `require_role` still applies it.
`GET /api/config` was listed as a liveness probe and is admin-gated at the
router, so `native_watchdog.sh` would have been waved through the gate and then
401'd anyway — a restart loop. The watchdog now probes `/api/health`, and
`/api/config` is asserted NOT public.

**`Authorization: Bearer` accepts a PAT, not just a JWT.** This is what makes
phase 3 possible at all: the LibreOffice macro, the Word add-in and the pipeline
scripts cannot hold a session cookie. Previously a PAT was decoded strictly as a
JWT and rejected as malformed.

### Phase 3 — clients migrated (all additive: no token, no change)

| Client | How it reads its token |
|---|---|
| `integrations/libreoffice-cite/gnosi_cite.py` | `api_token` in its config, or `GNOSI_API_TOKEN` |
| `frontend/public/word-addin/taskpane.js` | `localStorage['gnosi.wordAddin.apiToken']` |
| `pipeline/utils/rewalk_subpage_parents.py` | `GNOSI_API_TOKEN` |
| `pipeline/skills/notion_clone/scripts/backfill_notion_views.py` | `GNOSI_API_TOKEN` |
| `backend/tests/conftest.py` (E2E helpers) | `GNOSI_API_TOKEN` |
| `pipeline/skills/scheduler/SKILL.md` | documented `-H "Authorization: Bearer …"` |

The watchdogs and the compose healthcheck need no token: they only hit
`/api/health`.

### Remaining handover — needs a human

1. Create a PAT in Settings.
2. Paste it into each client above.
3. Run `set_user_password.py --i-understand --email <real>` (see below).
4. Set `GNOSI_REQUIRE_AUTH=1` and restart; roll back by unsetting it.

## Conditions that MUST be met before phase 3/4 — and before migrating

These came out of the third review round. They are ordered: the first one gates
running the script at all.

> **RESOLVED by phase 4** — kept because the reasoning explains the required
> ORDER below, and because unsetting the flag brings all three back.
>
> **Enable the flag BEFORE migrating, not after.** The window these conditions
> warn about only exists while enforcement is off. The script writes straight to
> the management DB over the filesystem, so it does not need the API and is not
> affected by the flag — which means the safe order has no gap in it:
>
> 1. `GNOSI_REQUIRE_AUTH=1`, restart. The UI is locked (you have no password
>    yet) but existing PATs keep working, and unsetting it rolls back.
> 2. Run `set_user_password.py --i-understand --email <real>`.
> 3. Log in with the new credentials.
>
> Doing it the other way round — migrate, then flip — leaves a window where the
> placeholder address is free and enforcement is still off, which is exactly the
> combination that mints `owner` accounts from a header.

### 1. Do NOT run `set_user_password.py` until header-driven minting is closed

Running it is what opens the hole. Today `_ensure_personal_exists` writes a
**fixed** email for every auto-created user while `users.email` is UNIQUE, so a
request carrying an unknown `X-User-ID` dies on an IntegrityError — verified.
The constraint is blocking ghost accounts *by accident*.

The moment the legacy account moves to a real address, the placeholder frees up
and the next unknown `X-User-ID` succeeds: new `User`, `Membership(role="owner")`
on the shared `personal` workspace, and a duplicate `Vault` row. (The one after
that fails on the same constraint again.) So the migration step this directive
recommends **removes a protection that currently exists**.

An earlier revision of this file claimed arbitrary headers already mint
accounts. That was wrong: they mint accounts only *after* the migration.

### 2. Generalize the claim guard — it currently matches one magic string

`register()` refuses to claim an account whose email equals `PLACEHOLDER_EMAIL`.
That covers one of **three** paths that create password-less accounts with
predictable addresses:

| Origin | Address | Guarded |
|---|---|---|
| `workspace_service._ensure_personal_exists` | `user@example.com` | yes |
| `backend/sh/init_management.py:36` | `ismael-legacy@gnosi.app` | **no** |
| `workspace_routes.py:29` (`POST /api/workspaces`) | `{x_user_id}@example.com` | **no** |

Verified that the guard returns False for the latter two, so `/register` still
claims those accounts on any install bootstrapped by them. String equality is the
wrong altitude: the property that matters is *"this account was never
deliberately invited"*, which no column records. Record it — a nullable
`invited_by`/`auto_provisioned` flag — and guard on that instead.

> **RESOLVED.** Phase 3/4 first generalized the string matching (whole
> `example.com` domain + the one `gnosi.app` literal), which closed all three
> paths above but kept inferring the property from the address. `users.
> auto_provisioned` now records it: every minting path sets it, and
> `is_auto_provisioned_account()` reads the column with the address heuristic
> kept as a SECOND line — the column can be absent in ways the code cannot see
> (a DB restored from a pre-column backup, a row inserted by hand), and the two
> only ever disagree in the direction that refuses a claim.
>
> The lightweight migration backfills from the address at the moment it adds the
> column. **This is load-bearing**: without it, existing rows default to 0
> ("invited") and the migration would REMOVE the protection an older install
> already has. Verified by removing the backfill and watching the migration
> tests fail.
>
> What the column buys over the heuristic, verified end-to-end: an account at a
> domain the heuristic returns False for is still refused (403) when the column
> is set — i.e. a fourth minting path is covered the moment it records the
> property, whatever address it invents. Tests:
> `test_auto_provisioned_accounts.py`, `test_auto_provisioned_migration.py`.

### 3. `POST /api/workspaces` is a second unauthenticated account factory

It declares only `x_user_id: str = Header(...)` and no role dependency, so an
unauthenticated caller mints a `User` **and** a `Workspace` owned by it. It is
absent from `PUBLIC_RULES`, so flipping the flag closes it — but until then it is
open, and it must be on the phase-4 list alongside `_ensure_personal_exists`.
Enforcement has to stop trusting `X-User-ID` everywhere, not just in one helper.
- **Do not** reject an over-long password during *verification*. passlib shipped
  `truncate_error=False`, so existing installs stored `hash(password[:72])` for
  anything longer and `/register` accepted 128 characters; rejecting outright
  locks those users out permanently, reported only as "wrong credentials".
  `verify_password` falls back to comparing the first 72 bytes for exactly this
  reason. Hashing still refuses, so no new account can reach that state.
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

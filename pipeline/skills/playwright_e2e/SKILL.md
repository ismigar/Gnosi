---
name: playwright-e2e
description: Run Gnosi Playwright smoke and authenticated tests against existing disposable services, or explicitly generate isolated Linux visual candidates.
---

# Playwright E2E

Use the existing Node 22.22.2 and pnpm 11.19.0 workspace toolchain. Dependency
provisioning, when separately authorized, uses the repository root frozen
`pnpm-lock.yaml` and `pnpm-workspace.yaml`; do not install from `tests/e2e` or
regenerate locks. The smoke wrapper provisions nothing. The Linux generator
installs dependencies only in its disposable container workspace; neither wrapper
installs browsers or changes host dependencies.

## Sources of truth

- [Playwright configuration](../../../tests/e2e/playwright.config.ts): projects,
  URLs, certificate policy, retries and reporters.
- [Root commands](../../../package.json) and [E2E commands](../../../tests/e2e/package.json).
- [CI](../../../.github/workflows/ci.yml): the current native smoke job.
- [Authentication fixture](../../../tests/e2e/tests/setup/auth.setup.ts) and
  [visual spec](../../../tests/e2e/tests/visual/regression.spec.ts).

Paths below are relative to the repository root unless stated otherwise. Run
against an explicitly chosen disposable test environment. A full feature suite
can write application data; a working frontend is not permission to test against
personal vaults or to call live AI/integration providers.

## Smoke against an existing service

From the repository root, invoke
`bash pipeline/skills/playwright_e2e/scripts/run_smoke.sh` for the readiness check
followed by `chromium-anon` with one worker. The wrapper locates the checkout from
its own path, so the caller's current directory does not select another checkout.

Set `GNOSI_BASE_URL` to select an explicit HTTP(S) URL. Otherwise, like the
Playwright config, the wrapper chooses HTTPS on localhost:5173 when
`frontend/certs/localhost.pem` exists, and HTTP on that port otherwise. An empty
override also uses this default. Vite has additional HTTPS overrides and cached
certificate state; specify the URL explicitly when the running server differs
from config's file-existence default. No certificate contents are read.

The exact base URL is passed to Playwright. The readiness request uses its origin
plus `/`, matching smoke's `page.goto('/')` even if the base URL includes a path
or query. URLs containing credentials or whitespace are rejected. The request
follows at most five HTTP(S) redirects with a three-second total timeout, ignores
user curl configuration, and requires both curl success and a final HTTP 2xx.
It ignores certificate verification to match Playwright's
`ignoreHTTPSErrors: true`; this is development compatibility, not TLS validation.

Unavailable services, HTTP errors, unresolved redirects and invalid URLs exit 2
without running tests. `STRICT` is obsolete: unset, `0` and `1` all fail on an
unavailable frontend. Once tests start, the wrapper returns pnpm/Playwright's
exit status unchanged. Neither wrapper nor config starts a service or falls back
to another port. Fix the selected service separately; do not auto-spawn one.

The root command `pnpm test:e2e:smoke` runs the E2E package directly, not this
wrapper. CI uses that root command. There is no repository-managed pre-push
hook here that guarantees the wrapper runs; do not claim hook enforcement.

## Projects and outputs

| Project | Tests under `tests/e2e/tests/` | Setup dependency |
| --- | --- | --- |
| `setup` | Files matching `*.setup.ts` | None; writes `.auth/state.json` |
| `chromium-anon` | `anon/` | None; anonymous shell smoke |
| `chromium-auth` | `e2e/` | `setup`; uses saved storage state |
| `accessibility` | `accessibility/` | `setup`; axe and keyboard/focus assertions |
| `visual` | `visual/` | `setup`; current regression spec runs only on macOS |

Root commands are `pnpm test:e2e`, `pnpm test:e2e:smoke`,
`pnpm test:e2e:a11y` and `pnpm test:e2e:ui`. For an individual project, run
`pnpm exec playwright test --project=PROJECT` from `tests/e2e`.

Config uses two workers locally and one in CI, with zero local retries and two
CI retries. Smoke's package command and wrapper explicitly select one worker.
Run only one suite at a time per checkout: reports, storage state and
`test-results/` are shared. Judge your own process exit status and report;
`.last-run.json` can belong to another run. Config writes HTML and list reports,
captures failure screenshots, retains failure videos, and traces the first retry.

## Authentication against a disposable account

The application has a [login screen](../../../frontend/src/features/auth/LoginPage.tsx).
[App](../../../frontend/src/app/App.tsx) shows it for unauthenticated users when
organization mode or the backend's auth requirement is active.
[AuthProvider](../../../frontend/src/features/auth/context/AuthProvider.tsx)
loads `/api/auth/me`, performs password login/registration through the API,
and persists returned user/workspace context. The
[backend auth routes](../../../backend/api/auth_routes.py) issue an HttpOnly
`gnosi_session` cookie. Request-context headers read stored values and retain
legacy fallback behavior; they are not a replacement for an authenticated session.

Setup requires `GNOSI_TEST_EMAIL` and `GNOSI_TEST_PASSWORD` for a disposable
account provisioned separately. It logs in, requires the HttpOnly cookie and
verifies the returned identity through `/api/auth/me`. It never registers,
claims, resets or promotes an account. `GNOSI_TEST_WORKSPACE_ID` must match a
returned membership; without it, exactly one membership is required. The actual
role and identity are persisted with Catalan locale and optional
`GNOSI_TEST_VAULT_ID`; headers do not grant access. Do not use personal credentials
or disable authentication to satisfy setup.

`GNOSI_TEST_STORAGE_STATE` overrides the ignored `tests/.auth/state.json` output;
use an absolute path under the disposable validation root for isolated runs.
The writer refuses symlink destinations and restricts the file to mode600 before
writing. Setup disables screenshots, video and tracing and authenticates before
the test-step recorder, sanitizing transport failures. Unset `DEBUG`/`PWDEBUG`;
do not enable authentication diagnostics that can expose cookies or passwords.

Run `pnpm test:e2e:contracts` for the offline request/validation/permission tests
and strict setup typing; CI runs this without credentials. These tests do not
replace actual setup and browser acceptance. Some feature specs mock auth:
their project name alone does not prove login coverage. Anonymous smoke can see
the login screen rather than the authenticated application shell.

## Visual baselines and explicit Linux generation

The current regression spec explicitly skips every platform except Darwin. It
checks home, vault, calendar and contacts at desktop and mobile sizes. Baselines
live in `tests/e2e/tests/visual/regression.spec.ts-snapshots/` as
`<route>-<viewport>-visual-darwin.png`. The spec sets English/light theme and masks
dynamic areas; config disables animations and allows a 0.02 pixel-difference ratio.
Update macOS baselines only for reviewed intentional UI changes, using the
`visual` project with `--update-snapshots` in the chosen test environment.

Linux snapshots are not consumed by the shared visual spec or CI, and there is
no `e2e-update-baselines.yml` workflow. To generate Linux candidates deliberately,
set `GNOSI_PLAYWRIGHT_IMAGE` to a trusted, already prepared local image with Bash,
curl, standard file utilities, Node 22.22.2, pnpm 11.19.0 and Linux Chromium matching
the Playwright version in the root lock. An arbitrary official Playwright image
does not guarantee the required Node/pnpm versions. The wrapper checks versions,
uses `--pull=never`, and never builds images or downloads browsers. Image
preparation is a separate authorized operation; missing/mismatched tooling fails.

Set `GNOSI_BASE_URL` explicitly to the existing frontend URL reachable from that
container, for example `https://host.docker.internal:5173`. There is no default,
host-local probe or automatic scheme/port substitution. The container performs
the same bounded final-2xx readiness check and development TLS policy as smoke.
It receives only that URL, its derived probe origin, explicitly supplied test
credentials/selectors and fixed CI/tool settings. Test credentials are forwarded
by environment key name, never embedded in Docker command arguments. Unrelated
host credentials and saved sessions are not forwarded.

Run the wrapper with `--update-snapshots --output-dir /absolute/new-candidates-directory`.
Both flags are required. The output parent must exist, the new directory must
be outside the checkout and dependency directories, and existing output is never
overwritten. This explicitly authorizes dependency installation and candidate
generation, not a baseline update in source. Do not invoke it as an automatic
retry or to silence a failing visual comparison.

The wrapper copies only root manifests/locks, the three workspace package
manifests, the reviewed patch, toolchain check, Playwright config, auth setup,
its two production support modules and the
visual spec into a temporary staging directory. It rejects symlink inputs and
does not copy host `node_modules`, certificates, `.env`, `.npmrc`, storage state,
vaults or existing baselines. Only that staging copy is mounted read-only. The
container copies it into its own temporary workspace and installs from the root
with `pnpm install --frozen-lockfile --ignore-scripts`. Lifecycle scripts are
unneeded for this E2E-only workspace and would otherwise trigger desktop builds.
It runs the toolchain check and verifies lock/workspace bytes remain unchanged.

Generation explicitly removes the known Darwin-only skip statement from the
temporary visual spec; it fails if that statement has changed or is not unique.
The shared spec is untouched. It runs `visual` plus its setup dependency, with
snapshot updates, one worker and zero retries. Setup requires a real login on the
selected disposable backend; its session output stays inside the container.
Missing test credentials fail before Docker starts. Never weaken authentication
to obtain snapshots.

On success, it verifies all eight expected `<route>-<viewport>-visual-linux.png`
files are regular non-symlink PNGs, copies only those names to temporary export
storage, and checks them again before returning candidates to the requested new
directory. Extra files, reports, auth state and dependencies are not exported.
No source snapshots are overwritten. Playwright/install/container failures
remain nonzero, and even exit 0 with missing snapshots fails. Host staging is
removed on exit; the container uses `--rm`. Review the images before any separate
decision to adopt Linux baselines; generating them does not establish CI parity.

The previous unsafe source-mount implementation is replaced, not retired with
an error-only stub. Historical preservation and any future deletion belong to
the integration owner; do not remove host dependencies or older snapshots.

## Current CI and validation boundaries

The canonical workflow runs on pull requests and pushes to main, without the old
frontend path filter. Its Ubuntu `native-smoke` job installs the frozen root
pnpm/uv workspaces and Chromium, starts native backend and Vite services, checks
their readiness, then runs anonymous smoke with
`GNOSI_BASE_URL=http://127.0.0.1:5173`. It does not shard E2E, run visual comparisons,
serve a production preview, or upload Playwright report artifacts. The separate
Docker job validates/builds application images; it is not a visual baseline job.

Keep explicit keyboard, focus, dialog and live-region checks alongside axe; a
zero-violation axe result does not prove those interactions. Use visible,
locale-aware selectors and isolate live provider calls in feature tests.

For wrapper maintenance, run `pipeline/tests/test_e2e_wrappers.py` with the existing
Python environment, strict mypy on that file, Ruff and `bash -n` on both wrappers.
The tests use executable doubles and disposable directories, not real browsers,
containers, services, installs or credentials. They establish wrapper contracts
only; they do not certify application E2E or cross-platform visual acceptance.

## Failure lessons

- Note: do not return success when a service is unavailable, because callers
  then accept a smoke suite that never ran. Fail before invoking Playwright.
- Note: do not accept a redirect status or ignore curl's exit code, because a
  redirect can end at an error and a transfer can fail after reporting 200.
  Require a completed request and final 2xx instead.
- Note: do not infer baseline generation from Playwright exit 0, because skipped
  visual tests also succeed. Confirm supported platforms and intended outputs.
- Note: do not install dependencies into a writable source mount, because that
  can replace host dependencies with Linux binaries. Stage reviewed files and
  install in the disposable container workspace instead.
- Note: do not seed an invented user or admin role, because browser storage does
  not authenticate a session. Use login, a verified cookie and actual membership.
- Note: disabling traces alone does not stop raw API errors entering test reports.
  Authenticate before the step recorder and return sanitized diagnostic messages.

# Gnosi E2E Tests (Playwright)

Browser tests connect to an already running frontend and its backend. Native
development defaults remain backend port 5002 and frontend port 5173; an explicitly
configured portable deployment also works. No test configuration starts services,
selects another port, or requires a LaunchAgent or a maintainer's machine.

Use the installed root workspace toolchain: Node 22.22.2, pnpm 11.19.0 and the
locked Playwright dependencies. Dependency/browser provisioning is a separate
operation; the commands below install nothing. Do not install from this folder
or modify the root lock to run tests.

## Choose an isolated target

Set `GNOSI_BASE_URL` to the existing disposable frontend, for example
`http://127.0.0.1:5173`. Its `/api` routes must reach the intended isolated backend.
The config otherwise retains its HTTP/HTTPS localhost:5173 default based only on
the existence of `frontend/certs/localhost.pem`. It does not read certificates.
The existing `ignoreHTTPSErrors` setting is preserved for local development; this
is not production TLS verification. Authentication uses the same origin as
`page.goto('/')`, even when the configured URL includes a path or query.

Never target personal vaults or a maintainer's account. Feature tests can write
application data or call providers. The principal provisions synthetic data and
reviews provider isolation before running a real suite.

## Default builds and nested entry regression

Build from the root with `pnpm build:frontend`, leaving `VITE_BASE_PATH` unset.
The default `/` asset base supports direct nested routes for both web and
Electron's standard origin. An explicitly relative base can recreate a blank
page after deep-link entry or reload; do not hide that failure by navigating
from a warmed shell or increasing timeouts.

`vault-entrypoints.spec.ts` enters a prepared table directly through both legacy
and canonical URLs, then reloads and requires real visible rows, the canonical
URL and no script/stylesheet HTTP errors or uncaught page errors. Supply
`GNOSI_TEST_TABLE_ID`, `GNOSI_TEST_VAULT_ID` and `GNOSI_TEST_WORKSPACE_ID` for the
same disposable account; without them these two tests explicitly skip. An
invalid supplied target fails. These tests create no data and do not replace
the broader feature, authentication, accessibility or platform suites.

## Authenticated setup

The `setup` project logs into an **existing, pre-provisioned disposable account**.
It only calls `POST /api/auth/login` and `GET /api/auth/me`. It never registers,
claims, resets, changes passwords, adds memberships or disables authentication.

Supply inputs through the test process environment, using the principal's fixture
provisioner or protected CI environment. Do not put credentials in command-line
arguments, shell history, logs, source files or reports. This setup loads no `.env`
files and has no default email or password.

| Variable | Contract |
| --- | --- |
| `GNOSI_TEST_EMAIL` | Required explicit fixture email; trimmed and compared case-insensitively with the returned identity. |
| `GNOSI_TEST_PASSWORD` | Required nonblank fixture password; passed unchanged, including leading/trailing spaces. |
| `GNOSI_TEST_WORKSPACE_ID` | Optional when the verified account has exactly one membership; otherwise required and must match a membership from `/api/auth/me`. |
| `GNOSI_TEST_VAULT_ID` | Optional pre-provisioned vault selection. It does not grant access or create a vault. |
| `GNOSI_TEST_STORAGE_STATE` | Optional output path shared by setup and all authenticated projects. Use an absolute path under `GNOSI_VALIDATION_ROOT` for isolated QA; relative paths resolve from `tests/e2e`. Empty/unset preserves the existing default. |

Empty workspace/vault selectors are treated as absent. Missing credentials fail
before even creating the request client. Missing/invalid profiles, malformed or
duplicate memberships, unknown roles, zero memberships, ambiguous selection,
identity mismatches, failed login and failed session verification all fail setup.
The supported roles mirror the backend: owner, admin, editor and viewer. The
saved role always comes from the selected `/api/auth/me` membership; no role is
invented. Both API responses must be HTTP 200; redirects are not followed and each
request has a 15-second timeout.

Every attempt uses a fresh request cookie jar, checks a nonempty HttpOnly
`gnosi_session` cookie for the frontend origin, verifies the login ID/email against
`/api/auth/me`, and checks the cookie again before saving. The setup does not launch
a browser or load the application, so it cannot demonstrate browser acceptance
or dismiss release notes. Real browser validation belongs to the principal.

The default saved state remains `tests/e2e/tests/.auth/state.json` from the repository
root (`tests/.auth/state.json` from the E2E package). `GNOSI_TEST_STORAGE_STATE`
redirects both the output and every dependent project's input to the same path;
it does not copy or inspect the default state. The state contains the real session
cookie and localStorage entries for the verified user ID, email, workspace, role,
Catalan locale (`i18nextLng=ca`) and optional active vault. No password is stored.
The default file is git-ignored; keep overrides outside tracked source too. State
is restricted to mode 600 **before** session bytes are written, including when a
destination already exists, on POSIX filesystems. A final-component symlink is
refused where the platform supports `O_NOFOLLOW`. Treat the file
as a credential: do not print, commit, upload or share it. Failed authentication
does not save new state; an older file may remain, but failed setup blocks dependent
projects. Do not bypass setup with `--no-deps` or reuse stale state to turn a failure
green.

### Setup privacy

The `setup` project and its setup file explicitly disable tracing, videos and
screenshots, including retries. Authentication runs in an automatic worker fixture
before Playwright's per-test API step recorder; the client is disposed before the
test body. This avoids exposing raw transport errors in report steps. Adapter
errors use fixed messages, without response bodies, input values or nested causes.
`DEBUG` and active `PWDEBUG` are rejected before authentication. Do not enable
custom loggers, protocol diagnostics or instrumentation that captures credentials.

Other projects retain their existing failure artifacts. Authenticated browser
traces can contain session cookies and synthetic user data: keep their reports
private too. Turning off setup captures does not sanitize downstream artifacts.

## Commands from the repository root

Anonymous smoke needs no account and has no setup dependency:

```bash
GNOSI_BASE_URL=http://127.0.0.1:5173 pnpm test:e2e:smoke
```

After the principal has provisioned the isolated account, injected its environment
and started the chosen services:

```bash
pnpm --filter @gnosi/e2e exec playwright test --project=setup --workers=1
pnpm --filter @gnosi/e2e exec playwright test --project=chromium-auth --workers=1
pnpm --filter @gnosi/e2e typecheck
pnpm test:e2e:a11y
pnpm test:e2e
pnpm --filter @gnosi/e2e report
```

Only run one suite per checkout at a time: storage state and reports are shared.
Do not run authenticated setup with `test:debug`/`PWDEBUG`; use offline validation
for setup diagnostics. API setup success alone is not a browser or release test.
Some feature specs mock auth responses; their project name does not prove a real
authenticated flow. The principal must verify the unmocked cookie/browser flow.

Dashboard API requests default to the configured browser origin through its
`/api` proxy, not a separate localhost:5002 service. If `GNOSI_API_BASE` is supplied,
it must explicitly select the same disposable backend. Chat mocks cover both
`/api/chat` and `/api/v1/vaults/{slug}/ai/chat`; session and replay endpoints are
separate contracts, not swallowed by that matcher.

For title-editing acceptance, set `GNOSI_TEST_TABLE_ID` to an ordinary table
provisioned with at least two rows inside the selected disposable vault. An
explicit target opens through the real sidebar and fails if its rows cannot
render; it never silently skips. This editing flow does not certify cold
direct-deep-link startup or reload readiness.
Without this selector, the spec discovers a suitable table and may skip when
none is available. Discovery uses the configured workspace/vault selectors.
Mail fixtures cover legacy and vault-scoped APIs; integrations matching excludes
Vite source-module paths so the mock cannot replace application code with JSON.

## Offline worker validation

The root `pnpm test:e2e:contracts` command runs offline authentication, JSON and
API-route contracts, then strict TypeScript checking of all active E2E `.ts` and
`.tsx` files through `tsconfig.json`. This includes feature, anonymous,
accessibility and visual specs, not just setup. The focused `typecheck:auth`
alias remains available for compatibility. Neither check launches browsers or
certifies actual feature behavior; archived JavaScript under `tests/legacy` is
not part of the configured projects or this TypeScript check.

These commands use only synthetic in-memory profiles, request doubles and
disposable files created by the tests themselves. They do not run Playwright,
launch a browser, contact a service, read environment files or load existing saved
auth state. Run them with the existing Node 22.22.2 toolchain:

```bash
node --experimental-strip-types --test tests/e2e/support/auth-state.test.ts tests/e2e/support/auth-playwright.test.ts

node frontend/node_modules/typescript/bin/tsc --noEmit --strict --noUncheckedIndexedAccess --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --types node --typeRoots tests/e2e/node_modules/@types tests/e2e/support/auth-state.ts tests/e2e/support/auth-playwright.ts tests/e2e/support/auth-state.test.ts tests/e2e/support/auth-playwright.test.ts tests/e2e/tests/setup/auth.setup.ts tests/e2e/playwright.config.ts
```

Node may emit `MODULE_TYPELESS_PACKAGE_JSON` because it detects ES modules in the
TypeScript test files. This is benign; do not change package module mode just to
silence it. Type-only Playwright imports are erased by Node's type stripping, so
the offline request-double tests do not load the Playwright runtime.

## Layout and Linux integration

```text
tests/e2e/
├── playwright.config.ts
├── package.json
├── support/
│   ├── auth-state.ts             # Pure typed input/profile/session/path validation
│   ├── auth-state.test.ts        # Deterministic validation cases
│   ├── auth-playwright.ts        # Typed request adapter and restricted state output
│   └── auth-playwright.test.ts   # Offline request/error/cleanup/permission contracts
└── tests/
    ├── setup/auth.setup.ts
    ├── anon/
    ├── e2e/
    ├── accessibility/
    ├── visual/
    └── .auth/state.json          # Default sensitive output, never a source input
```

Real backend provisioning and browser QA are separate from setup. The Linux
visual generator's staging allowlist includes both
`support/auth-state.ts` and `support/auth-playwright.ts` alongside `auth.setup.ts`.
It requires explicit test credentials and forwards them and optional workspace/
vault selectors by environment key name, never credential values in Docker
arguments. Its storage output stays inside the container. Only the eight reviewed
PNG candidates are exported. Copying only the old setup file is insufficient.
See the [E2E skill](../../pipeline/skills/playwright_e2e/SKILL.md) for invocation
and safety boundaries. Offline contracts do not certify the real Linux platform.

### Maintenance lessons

- Note: do not seed a fixed user or admin role, because localStorage does not
  authenticate a session. Login and verify the real cookie and membership instead.
- Note: do not use the first membership when several exist, because tests may
  write to the wrong workspace. Require an explicit matching workspace selector.
- Note: do not throw raw API errors or inspect failed response bodies, because
  they can echo credentials or cookies. Report fixed diagnostic messages instead.
- Note: do not rely only on disabling trace files, because Playwright can still
  record raw API errors as report steps. Keep authentication before the per-test
  recorder in its automatic worker fixture and retain both capture guards.
- Note: do not change the package to ESM just to suppress Node's type-stripping
  warning, because Playwright configuration currently relies on `__dirname`.
- Note: do not apply mode 600 only after writing, because an existing destination
  may be readable by other users. Restrict the opened file before truncating or
  writing, and use an ephemeral output override for isolated QA.
- Keep the pure helper independent of Playwright and validate unknown JSON before
  deriving storage state. Offline doubles prove contracts; only the principal's
  isolated real API and browser checks establish actual E2E acceptance.

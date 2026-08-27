# Gnosi E2E Tests (Playwright)

End-to-end tests for the Gnosi frontend, running on the **host** (macOS) and targeting the native Vite frontend at `http://localhost:5173` or `https://localhost:5173`.

## Why a separate project?

Playwright is kept at the host level so browser tests use the same native runtime as local development and do not add test-only dependencies to the frontend workspace. See `docs/dev_memory/directives/playwright_setup.md`.

Docker remains a supported deployment mode, but it is not a local fallback on this Mac.

## Setup (first time)

```bash
pnpm install --frozen-lockfile
pnpm test:e2e:install
```

## Running tests

Make sure the native LaunchAgents are running first:

```bash
launchctl print "gui/$UID/com.gnosi.frontend-native"
launchctl print "gui/$UID/com.gnosi.backend-native"
```

Then:

```bash
pnpm test:e2e:smoke     # quick smoke test (~5s)
pnpm test:e2e           # full suite
pnpm --filter @gnosi/e2e test:headed
pnpm --filter @gnosi/e2e test:debug
pnpm test:e2e:ui
pnpm --filter @gnosi/e2e report
```

## Targeting a different URL

```bash
GNOSI_BASE_URL=http://localhost:5173 pnpm test:e2e
```

## Layout

```
tests/e2e/
├── playwright.config.ts
├── package.json
├── tests/
│   └── tests/e2e/
│       └── smoke.spec.ts    # baseline — must always pass
└── tests/.auth/             # (git-ignored) cached storage state
```

## When to add a test

A new spec is justified when a regression in the corresponding feature would silently ship to users. Smoke tests cover the app shell; per-feature specs cover individual flows (vault, calendar, contacts, etc.).

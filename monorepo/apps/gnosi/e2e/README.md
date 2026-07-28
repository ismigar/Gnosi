# Gnosi E2E Tests (Playwright)

End-to-end tests for the Gnosi frontend, running on the **host** (macOS) and targeting the native Vite frontend at `http://localhost:5173` or `https://localhost:5173`.

## Why a separate project?

Playwright is kept at the host level so browser tests use the same native runtime as local development and do not add test-only dependencies to the frontend workspace. See `docs/dev_memory/directives/playwright_setup.md`.

Docker remains a supported deployment mode, but it is not a local fallback on this Mac.

## Setup (first time)

```bash
cd monorepo/apps/gnosi/e2e
npm install
npx playwright install chromium
```

## Running tests

Make sure the native LaunchAgents are running first:

```bash
launchctl print "gui/$UID/com.gnosi.frontend-native"
launchctl print "gui/$UID/com.gnosi.backend-native"
```

Then:

```bash
npm run test:smoke      # quick smoke test (~5s)
npm test                # full suite
npm run test:headed     # see the browser
npm run test:debug      # step through with Playwright Inspector
npm run test:ui         # Playwright UI mode (best DX)
npm run report          # open last HTML report
```

## Targeting a different URL

```bash
GNOSI_BASE_URL=http://localhost:5173 npm test
```

## Layout

```
e2e/
├── playwright.config.ts
├── package.json
├── tests/
│   └── e2e/
│       └── smoke.spec.ts    # baseline — must always pass
└── tests/.auth/             # (git-ignored) cached storage state
```

## When to add a test

A new spec is justified when a regression in the corresponding feature would silently ship to users. Smoke tests cover the app shell; per-feature specs cover individual flows (vault, calendar, contacts, etc.).

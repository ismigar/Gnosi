# Gnosi E2E Tests (Playwright)

End-to-end tests for the Gnosi frontend, running on the **host** (macOS) and targeting the **Docker frontend** at `http://localhost:5173`.

## Why a separate project?

The Gnosi frontend container runs on **Alpine Linux** (musl libc). Playwright browser binaries are built against glibc and do not run on Alpine. Therefore Playwright is installed at the host level — see `docs/dev_memory/directives/playwright_setup.md`.

This also keeps the frontend `node_modules` clean of test-only dependencies.

## Setup (first time)

```bash
cd monorepo/apps/gnosi/e2e
npm install
npx playwright install chromium
```

## Running tests

Make sure the Docker frontend is up first:

```bash
docker ps | grep gnosi_frontend  # must be running on :5173
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

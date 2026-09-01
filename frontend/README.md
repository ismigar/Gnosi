# Gnosi frontend

Gnosi's frontend is a React 19 application built with Vite. It is one package
inside the repository's single pnpm workspace and runs natively on port 5173,
proxying `/api` to FastAPI on port 5002.

## Data access

- `src/generated/openapi.ts` is generated from `../openapi/openapi.json`.
- `src/shared/api/client.ts` owns the typed `openapi-fetch` client.
- `src/shared/api/ApiProvider.tsx` owns TanStack Query's application boundary.
- `src/shared/api/transports.ts` is the only ordinary browser-fetch boundary.
- `src/shared/api/specialized-transports.ts` owns SSE, WebSocket, streaming and
  download boundaries.

Production code must not import Axios or call `fetch` directly. The deterministic
guard and its reviewed exceptions are defined by `../scripts/check_frontend_api_boundary.py`
and `api-boundaries.json`.

## Commands

Run commands from the repository root:

```bash
pnpm dev:frontend
pnpm check:api-client
pnpm --filter @gnosi/frontend typecheck
pnpm test:frontend
pnpm lint:frontend
pnpm build:frontend
```

When a backend contract changes intentionally, regenerate and review both
artifacts:

```bash
pnpm generate:api-client
git diff -- openapi/openapi.json frontend/src/generated/openapi.ts
```

Do not hand-edit generated files. Fix the FastAPI response model or generator,
regenerate, and keep the source-boundary guard green.

## Test boundaries

Both `src/` and `tests/` TypeScript suites and helpers are included in the strict
compiler project and type-aware ESLint checks. A coverage contract rejects
JavaScript additions under `tests/` and files omitted from that project.

The Web Clipper and Word add-in suites execute the real browser scripts in
isolated VM contexts with jsdom markup, typed host doubles, and mocked HTTP.
They never contact a live backend, browser account, or Office document. Shared
helpers validate DOM control types and request bodies, use real `Response` and
`Headers` objects, and restore temporary globals and event registrations.

Run the connector and language suites without the rest of the application:

```bash
pnpm --filter @gnosi/frontend exec vitest run tests --maxWorkers=1 --minWorkers=1
```

These tests protect script behavior and integration contracts; they do not
replace installation and smoke testing inside the supported extension hosts.

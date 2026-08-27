# SKILL: Playwright E2E

End-to-end testing skill for the Gnosi frontend. Replaces the historical manual browser verification step (QA Protocol §2) with reproducible automated tests.

> **Status**: Stable. Promoted from `docs/dev_memory/directives/playwright_setup.md` after smoke + feature suite ran 22/22 green.

---

## 1. Architecture

| Layer | Location | Notes |
|-------|----------|-------|
| **App under test** | `apps/gnosi/frontend` | Served natively on `localhost:5173`; Docker remains a supported deployment mode |
| **Test project** | `apps/gnosi/e2e` | Separate npm project — runs on the **host** (macOS), NOT inside the Alpine frontend container |
| **Skill (this folder)** | `pipeline/skills/playwright_e2e` | SOPs, helper scripts, baseline-generation tooling |
| **CI** | `.github/workflows/e2e.yml` | Sharded 2-way Ubuntu runners |

### Why tests run on the host, not in Docker

The frontend container uses **Alpine Linux** (musl libc). Playwright browser binaries are compiled against **glibc** and won't run there. Running Playwright on the host (or in the official `mcr.microsoft.com/playwright` Docker image) is the standard pattern.

---

## 2. Test projects (Playwright `projects`)

Defined in [`e2e/playwright.config.ts`](../../../e2e/playwright.config.ts):

| Project | Test dir | Auth | Purpose |
|---------|----------|------|---------|
| `setup` | `tests/setup/` | seeds localStorage | Generates `tests/.auth/state.json` for downstream projects |
| `chromium-anon` | `tests/anon/` | none | **Smoke** — 5 tests, ~10s, runs on every push |
| `chromium-auth` | `tests/e2e/` | from setup | Feature tests: vault, calendar, contacts, AI chat (12 tests) |
| `accessibility` | `tests/accessibility/` | from setup | Axe WCAG 2.2 AA route matrix plus keyboard/focus contracts |
| `visual` | `tests/visual/` | from setup | Pixel-diff regression on 4 routes |

---

## 3. Commands (canonical)

From `apps/gnosi/e2e/`:

```bash
npm run test:smoke                            # smoke
npm test                                      # all projects
npm run test:a11y                             # accessibility gate only
npx playwright test --project=chromium-auth   # features only
npm run test:headed                           # see browser
npm run test:debug                            # step-through inspector
npm run report                                # last HTML report
```

Note: Do not invoke `npm run test:e2e:smoke` from the git root unless the root
package explicitly declares it, because the synchronized Gnosi root currently
exposes only workspace-wide `build` and `test` scripts. Instead, run
`npm run test:smoke` from `apps/gnosi/e2e`.

---

## 4. Authentication

Gnosi has **no login screen** — auth is header-based via localStorage:

| Key | Default | Used by |
|-----|---------|---------|
| `gnosi_workspace_id` | `'personal'` (fallback) | `X-Workspace-ID` header |
| `gnosi_user_email` | `''` (fallback) | `X-User-Email` header |
| `gnosi_role` | — | UI permission gates |

User ID is hardcoded to `'ismael-legacy'` in [`frontend/src/hooks/use-api.js:14`](../../../frontend/src/hooks/use-api.js).

The `setup` project (`tests/setup/auth.setup.ts`) seeds these keys and stores the resulting state at `tests/.auth/state.json` (git-ignored). Authenticated projects inherit it via `storageState`.

---

## 5. Visual regression

- Baselines live at `tests/visual/regression.spec.ts-snapshots/`.
- Filenames are platform-suffixed: `home-visual-darwin.png`, `home-visual-linux.png`.
- **Both must be committed** for the suite to pass on macOS dev and Linux CI.
- Use `scripts/generate_linux_baselines.sh` to produce Linux PNGs locally — see §7.
- Animations are disabled (`expect.toHaveScreenshot.animations: 'disabled'`).
- Dynamic regions (clocks, calendar titles) are masked via `mask: [...]`.

### When to update baselines

Only when the visual change is **intentional** (UI redesign, branding update). For bug fixes that shouldn't change pixels, a baseline failure is the bug — don't paper over it with `--update-snapshots`.

---

## 6. Restrictions / Edge cases

1. **Vite saturates with >2 parallel browser contexts** — config caps `workers: 2` locally. CI shards via `--shard` so 1 worker per shard is fine.
2. **`waitUntil: 'domcontentloaded'`** is mandatory for `page.goto`. Vite dev never reliably fires `load` because the HMR websocket is always active.
3. **i18n-agnostic selectors**: Playwright's default browser is `en-US`; the app has i18n. Use regex like `/(nou contacte|new contact|nuevo contacto)/i` — never hardcode a single language.
4. **`button:visible`** — the app has hidden mobile-toggle buttons that match `button` selectors. Always filter by visibility when targeting "first button" or similar.
5. **Mock LLM endpoints** — `tests/e2e/ai-chat.spec.ts` intercepts `/api/chat` with `page.route()`. Never let tests call real LLM APIs (cost + flakiness).
6. **Frontend must be UP** for tests to run. Pre-push hook checks `curl localhost:5173` first and skips if down (with warning).
7. **No `webServer` in config** — anti-ghosting per [`environment_integrity.md`](../../../../../docs/dev_memory/directives/environment_integrity.md). If `:5173` is dead, the test fails — we don't auto-spawn a second instance on `:5174`.
8. **One suite run at a time** — two simultaneous runs (e.g. two agent/work
   sessions on the same repo) share `test-results/`, overwrite
   `.last-run.json`, double the browser contexts against the single Vite dev
   server (see #1), and produce phantom failures. Observed on 2026-06-10: run A
   exited successfully with 12 passing tests while run B left `.last-run.json`
   reporting 18 failures. Before launching, `pgrep -fl 'playwright test'` must
   return no processes. Judge results by your run's exit code and output, not
   by `.last-run.json` (last writer wins).
9. **Axe is not the keyboard gate** — keep the explicit skip-link, focus-order,
   mobile-tab, dialog, and live-region assertions. A zero-violation axe result
   does not prove those behaviors.
10. **No permanent application violation allowlist** — fix first-party markup
    or shared tokens. Exclude only an uncontrollable third-party subtree and
    document the reason next to that narrow exclusion.
11. **Responsive navigation uses boolean `inert`** — React 19 drops an empty
    string expression for this boolean attribute. Pass the hidden-state
    boolean and assert both `inert` and focus restoration in the mobile test.
12. **One bounded shell reload** — if `#page-content-scroll` does not appear
    during native Vite bootstrap, the accessibility helper may reload once.
    A second failure is real and must fail the gate; never loop retries.
13. **Native controls first** — scrollable list rows, calendar dates, toggles,
    and sliders must use buttons or associated labels. A pointer-only `div`
    is not an acceptable keyboard implementation.
14. **Resolve the tracked checkout before starting Vite** — in the current
    `Projectes` checkout, the active frontend is `apps/gnosi/frontend`.
    Note: Do not start or diagnose `monorepo/apps/gnosi/frontend` merely
    because a legacy copy exists there, because it may contain only generated
    assets and causes `vite: command not found` or a static server without the
    `/api` proxy. Instead, confirm the path with Git, restore dependencies from
    the committed lockfile when `node_modules` is absent, and then run the
    native Vite server from the tracked frontend. Note: Do not let npm resolve
    the stale root workspace lock when restoring only this app, because it can
    fail with package/lock mismatches. Instead, use the frontend lockfile with
    workspace discovery disabled and a Node version satisfying the frontend's
    declared engine (currently `>=22.22.2`).
15. **Restore the E2E project independently when its runner is missing** —
    Note: Do not assume the root workspace provides the `playwright` binary,
    because a partially restored checkout fails with `playwright: command not
    found`. Instead, restore `apps/gnosi/e2e` from its own committed lockfile
    with workspace discovery disabled before running the smoke suite.
16. **Check both loopback families before starting Vite** — Note: Do not rely
    only on a Docker process-name check or an IPv4 bind attempt, because an
    orphan Vite process listening on the IPv6 wildcard can coexist with a new
    `127.0.0.1:5173` listener and create two competing dev servers. Instead,
    make `predev` probe both `127.0.0.1` and `::1` and fail if either accepts a
    connection.
17. **Wait for backend reloads before E2E** — Note: Do not start Playwright
    immediately after switching branches while `uvicorn --reload` is active,
    because application startup can take long enough for navigation tests to
    time out even though Vite already returns 200. Instead, require a successful
    `/api/health` response after the reload completes before launching the suite.

---

## 7. Cross-platform baselines (CI parity)

CI runs on Ubuntu, dev usually on macOS. Same UI → different fonts/anti-aliasing → false positive visual diffs. Solution: store **both** platform baselines (`*-darwin.png` AND `*-linux.png`).

### Recommended: GitHub Actions manual workflow

Triggers a clean Ubuntu runner that exactly matches the CI environment:

1. GitHub UI → **Actions** tab → **"E2E — Update Linux Visual Baselines (manual)"** → **Run workflow**.
2. Wait ~3 min. Download the artifact **`visual-baselines-linux`**.
3. Extract the PNGs into `apps/gnosi/e2e/tests/visual/regression.spec.ts-snapshots/`.
4. Commit + push. CI will now pass on Linux.

Workflow source: [`.github/workflows/e2e-update-baselines.yml`](../../../../../.github/workflows/e2e-update-baselines.yml).

### Best-effort: local Docker

```bash
npm run test:e2e:linux-baselines
```

Wraps `scripts/generate_linux_baselines.sh` which runs `mcr.microsoft.com/playwright:v<resolved>-jammy` against `host.docker.internal:5173`.

⚠️ **Known limitation**: Vite dev server's HMR websocket + relative `base` path can prevent React from bootstrapping when accessed via `host.docker.internal`. If it fails, use the GitHub Actions workflow instead — don't fight Vite dev. (`vite.config.js` has `server.allowedHosts: ["localhost", "host.docker.internal"]` to mitigate the most common failure.)

---

## 8. Git hooks integration

| Hook | Action | Skip flag |
|------|--------|-----------|
| `pre-commit` | `lint-staged` (ESLint --fix on staged JS/TS files) | `SKIP_LINT_STAGED=1 git commit` |
| `pre-push` | `npm run test:e2e:smoke` (skipped if `:5173` down) | `SKIP_E2E_SMOKE=1 git push` |

Hooks live at `Projectes/.husky/` (git root, not the monorepo).

---

## 9. CI

GitHub Actions workflow: [`.github/workflows/e2e.yml`](../../../../../.github/workflows/e2e.yml).

- **Triggers**: push/PR with changes under `apps/gnosi/frontend/`, `apps/gnosi/e2e/`, or the workflow itself.
- **Sharded 2-way**: `matrix.shard: [1/2, 2/2]`.
- **Caches** `~/.cache/ms-playwright` keyed on `e2e/package-lock.json` to skip Chromium download.
- Builds frontend with `vite preview` (production-like, no HMR) instead of Docker.
- Uploads `playwright-report/` always; uploads `test-results/` only on failure.

---

## 10. IDE integration

| IDE | Recommended setup |
|-----|-------------------|
| VS Code, Cursor, Antigravity (Code-OSS forks) | Extension `ms-playwright.playwright` — gutter Run/Debug, UI mode, codegen, trace viewer |
| WebStorm / IntelliJ | Native support since 2023.2 — no extension needed |
| Zed, Neovim, Sublime | CLI-only — `npm run test:e2e:ui` is the best agnostic experience |

---

## 11. Future work

- [ ] Page Object Model when suite passes ~10 specs per area.
- [ ] Auth setup with real OAuth flow (currently fakes localStorage).
- [ ] Cross-browser matrix (Firefox + WebKit) for release branches.

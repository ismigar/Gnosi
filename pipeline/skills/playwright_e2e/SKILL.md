# SKILL: Playwright E2E

End-to-end testing skill for the Gnosi frontend. Replaces the historical manual browser verification step (QA Protocol §2) with reproducible automated tests.

> **Status**: Stable. Promoted from `docs/dev_memory/directives/playwright_setup.md` after smoke + feature suite ran 22/22 green.

---

## 1. Architecture

| Layer | Location | Notes |
|-------|----------|-------|
| **App under test** | `frontend/` | Served natively on `localhost:5173`; Docker remains a supported deployment mode |
| **Test project** | `tests/e2e/` | pnpm workspace package — runs on the **host** (macOS), NOT inside the Alpine frontend container |
| **Skill (this folder)** | `pipeline/skills/playwright_e2e` | SOPs, helper scripts, baseline-generation tooling |
| **CI** | `.github/workflows/ci.yml` | Canonical Node/Python validation and Playwright smoke |

### Why tests run on the host, not in Docker

The frontend container uses **Alpine Linux** (musl libc). Playwright browser binaries are compiled against **glibc** and won't run there. Running Playwright on the host (or in the official `mcr.microsoft.com/playwright` Docker image) is the standard pattern.

---

## 2. Test projects (Playwright `projects`)

Defined in [`tests/e2e/playwright.config.ts`](../../../tests/e2e/playwright.config.ts):

| Project | Test dir | Auth | Purpose |
|---------|----------|------|---------|
| `setup` | `tests/setup/` | seeds localStorage | Generates `tests/.auth/state.json` for downstream projects |
| `chromium-anon` | `tests/anon/` | none | **Smoke** — 5 tests, ~10s, runs on every push |
| `chromium-auth` | `tests/e2e/` | from setup | Feature tests: vault, calendar, contacts, AI chat (12 tests) |
| `accessibility` | `tests/accessibility/` | from setup | Axe WCAG 2.2 AA route matrix plus keyboard/focus contracts |
| `visual` | `tests/visual/` | from setup | Pixel-diff regression on 4 routes |

---

## 3. Commands (canonical)

From the `Gnosi/` repository root:

```bash
pnpm test:e2e:smoke          # smoke only (~10s)
pnpm test:e2e:a11y           # axe + keyboard accessibility gate
pnpm test:e2e                # full suite (~3min)
pnpm test:e2e:ui             # interactive UI mode
```

From `tests/e2e/` directly (low-level):

```bash
pnpm exec playwright test --project=chromium-anon   # smoke
pnpm exec playwright test --project=chromium-auth   # features only
pnpm exec playwright test --project=accessibility   # accessibility gate only
pnpm exec playwright test --headed                  # see browser
pnpm exec playwright test --debug                   # step-through inspector
pnpm exec playwright show-report                    # last HTML report
```

---

## 4. Authentication

Gnosi has **no login screen** — auth is header-based via localStorage:

| Key | Default | Used by |
|-----|---------|---------|
| `gnosi_workspace_id` | `'personal'` (fallback) | `X-Workspace-ID` header |
| `gnosi_user_email` | `''` (fallback) | `X-User-Email` header |
| `gnosi_role` | — | UI permission gates |

User ID is hardcoded to `'ismael-legacy'` in [`frontend/src/hooks/use-api.js:14`](../../frontend/src/hooks/use-api.js).

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
7. **No `webServer` in config** — anti-ghosting per [`environment_integrity.md`](../../../../docs/dev_memory/directives/environment_integrity.md). If `:5173` is dead, the test fails — we don't auto-spawn a second instance on `:5174`.
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

---

## 7. Cross-platform baselines (CI parity)

CI runs on Ubuntu, dev usually on macOS. Same UI → different fonts/anti-aliasing → false positive visual diffs. Solution: store **both** platform baselines (`*-darwin.png` AND `*-linux.png`).

### Local Docker

```bash
pipeline/skills/playwright_e2e/scripts/generate_linux_baselines.sh
```

The script runs `mcr.microsoft.com/playwright:v<resolved>-jammy` against
`host.docker.internal:5173` and installs the root frozen pnpm workspace.

⚠️ **Known limitation**: Vite dev server's HMR websocket + relative `base` path can prevent React from bootstrapping when accessed via `host.docker.internal`. If it fails, use the GitHub Actions workflow instead — don't fight Vite dev. (`vite.config.js` has `server.allowedHosts: ["localhost", "host.docker.internal"]` to mitigate the most common failure.)

---

## 8. Git hooks integration

| Hook | Action | Skip flag |
|------|--------|-----------|
| `pre-commit` | `lint-staged` (ESLint --fix on staged JS/TS files) | `SKIP_LINT_STAGED=1 git commit` |
| `pre-push` | `npm run test:e2e:smoke` (skipped if `:5173` down) | `SKIP_E2E_SMOKE=1 git push` |

Repository checks are enforced by the canonical GitHub Actions workflow.

---

## 9. CI

GitHub Actions workflow: [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml).

- **Triggers**: push/PR with changes under `frontend/`, `tests/e2e/`, or the workflow itself.
- **Sharded 2-way**: `matrix.shard: [1/2, 2/2]`.
- **Caches** `~/.cache/ms-playwright` keyed on the root `pnpm-lock.yaml` to skip Chromium download.
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

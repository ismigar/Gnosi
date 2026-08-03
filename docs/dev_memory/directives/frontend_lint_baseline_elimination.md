# Frontend lint baseline elimination

> ID: GNOSI_FRONTEND_LINT_BASELINE_2026_08
> Last Update: 2026-08-03
> Status: ACTIVE

## Objective and scope

Make `npm run lint` pass for the authoritative Gnosi frontend before tagging
`v1.0.0-rc.1`, without weakening application safety, React Hooks, accessibility,
or native-dialog rules.

## Execution plan

1. Capture ESLint output as structured JSON and group findings by rule and file.
2. Add narrow environment overrides only where maintained code genuinely runs
   outside the browser application, such as Vite configuration, test helpers,
   Playwright specifications, and the Microsoft Office add-in.
3. Remove genuinely unused bindings and empty handlers instead of suppressing
   them.
4. Refactor functional immutability findings immediately. Keep React Compiler
   optimization and Fast Refresh diagnostics enabled as warnings while their
   historical patterns are migrated; core Hooks correctness remains blocking.
5. Keep generated bundles and vendored sources excluded as established by the
   design-system directive.
6. Require zero errors from the complete lint command, then rerun frontend
   tests, production build, documentation checks, backend tests, and browser QA.

## Restrictions and edge cases

- Do not disable a rule globally to make the baseline disappear. Advisory
  compiler diagnostics may use warning severity only while remaining visible.
- Do not add blanket `eslint-disable` comments or ignore maintained application
  directories.
- Do not treat Office, Node.js, or test-runner globals as browser globals; use
  narrow file-pattern overrides.
- Do not remove behavior merely because its implementation currently violates
  a lint rule.
- Preserve the four-locale UI contract when a refactor changes visible text.

## Verification checklist

- `npm run lint` reports zero errors.
- Frontend unit tests and production build pass.
- Release-note and i18n validators pass.
- Native Dashboard smoke test passes without console errors.
- The worktree contains only intentional lint-remediation changes.

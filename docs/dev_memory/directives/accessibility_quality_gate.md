# Accessibility Quality Gate Directive

> ID: 2026-08-21 · Status: active
>
> Companion directives: `environment_integrity.md`,
> `i18n_and_english_standardization.md`, and `autonomous_quality_loop.md`.

## Objective

Keep Gnosi operable with a keyboard and understandable to assistive technology
across the application shell and every product domain. Accessibility is a
release gate, not a visual polish pass.

The gate targets WCAG 2.2 AA and combines automated axe checks with explicit
interaction assertions. Axe is necessary for semantics and color contrast but
does not prove focus order, keyboard completion, modal focus management, or
live announcements by itself.

## Authoritative scope

- React application: `monorepo/apps/gnosi/frontend/src/`.
- Browser acceptance tests: `monorepo/apps/gnosi/e2e/`.
- CI workflow: `monorepo/.github/workflows/e2e.yml`.
- English, Catalan, Spanish, and French locale catalogs under
  `frontend/src/locales/`.
- Canonical modal keyboard behavior: `frontend/src/hooks/useModalKeyboard.js`.

The accessibility gate covers the app shell plus one stable route from every
top-level product domain. A domain route may mock remote or mutable data, but
the rendered React surface and its accessibility tree must be real.

## Required contracts

### Automated audit

- Run `@axe-core/playwright` against the representative route matrix in both
  light and dark themes when color tokens or shared layout change.
- Fail on every axe violation in the tested scope. Do not keep a permanent
  violation allowlist; narrowly exclude third-party or canvas internals only
  when the application cannot control their markup, and document the reason at
  the exclusion site.
- Include `color-contrast` in the normal ruleset. Do not disable it for dark
  mode, skeletons, disabled controls, or mobile layouts.
- Enable the optional product modules represented by the route matrix in the
  deterministic browser fixture. A route redirected to a disabled-plugin
  placeholder has not audited the product surface.
- Fail the route gate on unhandled browser page errors as well as axe
  violations. A crashed or partially rendered page must never count as an
  accessibility pass.

### Keyboard and focus

- Every interactive control is reachable and operable without a pointer.
- DOM order is the focus order. Positive `tabindex` values are prohibited.
- All keyboard focus has a visible indicator with at least a three-to-one
  contrast change against adjacent colors in light and dark themes.
- The app shell exposes a skip link that moves focus to the main content.
- Composite widgets such as tabs use roving `tabindex` and support Arrow keys,
  Home, and End without adding every tab to the page Tab sequence.

### Dialogs and overlays

- A modal dialog has `role="dialog"`, `aria-modal="true"`, and an accessible
  name from `aria-labelledby` or `aria-label`.
- Cancelable dialogs close with Escape. A non-cancelable in-flight operation
  may temporarily ignore Escape, but the reason must be explicit.
- Modal focus moves inside on open, cycles within the topmost dialog, and
  returns to the opener on close. Nested dialogs close one layer per Escape.
- Use `useModalKeyboard` for this contract instead of adding component-local
  global keyboard listeners.

### Names, tabs, and dynamic content

- Icon-only controls have localized accessible names. Form controls use a
  programmatic label; placeholder text is not a label.
- Tab controls expose `tablist`, `tab`, `aria-selected`, `aria-controls`, and
  matching `tabpanel` relationships. This applies equally to responsive and
  mobile-only tabs.
- Loading, completion, error, and route-transition messages use an appropriate
  status, alert, or live region. Announcements must be concise and must not
  repeat on unrelated renders.

## Internationalization contract

Accessible names and live announcements are user-visible strings. Add their
keys to all four locale catalogs and keep English inline defaults. Automated
selectors must accept every supported locale or use stable roles and test IDs;
they must never depend on a single translated label.

## Execution procedure

1. Run the existing axe route matrix and keyboard interaction suite before
   changing shared components.
2. Inventory dialogs, tabs, icon-only controls, live regions, positive
   `tabindex`, and CSS rules that remove outlines.
3. Repair shared primitives and tokens before component-specific symptoms.
4. Add a focused unit test for reusable focus or keyboard logic and a real
   browser assertion for the user-visible behavior.
5. Run i18n parity, frontend lint and build, relevant frontend tests, backend
   regression tests, the accessibility project, and the broader Playwright
   smoke suite.
6. Inspect the rendered light and dark UI at desktop and mobile widths with the
   keyboard and capture a screenshot for the change record.
7. Run the engineering documentation gate twice after all source and generated
   documentation changes are staged.

## Restrictions and edge cases

- Do not infer accessibility from a successful axe scan. Axe cannot determine
  whether focus returns correctly or whether a workflow is keyboard-complete.
- Do not remove outlines unless the same selector supplies an equally visible
  replacement in the same rule.
- Do not rely on `:focus-visible` alone to distinguish pointer and keyboard
  focus on text controls. Chromium intentionally matches focused inputs after
  pointer activation, which makes a global outline appear on every editable
  surface. Track the current input modality and use contextual indicators:
  existing control borders for fields, text decoration for links, and outlines
  for borderless controls.
- Do not use `title` as the only accessible name for an icon-only control; use
  a localized `aria-label` and retain `title` only as optional pointer help.
- Do not add `role="tab"` without the complete tab and panel relationship;
  incomplete ARIA can be less usable than native controls.
- Do not announce rapidly changing decorative data. Live regions are for
  meaningful state transitions, and errors that need immediate attention use
  `role="alert"`.
- Do not treat a hidden responsive duplicate as a keyboard target. Hidden tabs
  and navigation must be absent from the tab order.
- Do not include Notebook operational behavior in an accessibility change.
  Accessibility semantics for its existing mobile tabs are in scope; indexing,
  refresh, chat, source, and lifecycle behavior are not.
- Do not guard `matchMedia` only during initial state calculation and call it
  unconditionally from an effect; that breaks SSR and JSDOM accessibility
  tests. Guard both boundaries and keep the non-browser fallback non-matching.
- Do not wait for Playwright `networkidle` during authenticated setup; Vite HMR
  and application polling can consume the whole test timeout after the UI is
  already usable. Wait for a real application DOM sentinel instead.
- Do not render React's `inert` boolean attribute as an empty-string
  expression; React 19 omits it. Pass the responsive hidden-state boolean so
  the browser removes hidden navigation from both the accessibility tree and
  sequential focus order.
- Do not make a scrollable list item, calendar date, toggle, or other control
  pointer-only with `div[onClick]`. Prefer its native `button`, `a`, or form
  control semantics so keyboard behavior and accessible naming are built in.
- Do not add an unbounded navigation retry to hide application bootstrap
  failures. The native Vite acceptance gate may perform one bounded reload if
  the application shell sentinel does not appear, then it must fail normally.
- Do not scan only empty or default product states. Exercise representative
  persisted controls and error/loading states because graph panels, calendar
  selectors, and planning errors can expose different names and contrast.
- Do not mix FullCalendar major versions. Keep `@fullcalendar/react` aligned
  with core and view plugins; a mixed v7/v6 installation crashes the calendar
  before its accessibility tree can be audited.
- Do not weaken the axe impact threshold, exclude an application-owned subtree,
  or update visual baselines merely to make the gate pass.

## Required evidence

- Axe passes on the representative product-route matrix, including color
  contrast in light and dark modes.
- Keyboard tests prove skip navigation, visible focus, logical focus order,
  mobile tab navigation, dialog Escape, focus trap, and focus restoration.
- Accessible-name assertions cover icon-only navigation and a representative
  form/dialog surface.
- Live-region assertions cover route transitions and a representative dynamic
  status.
- Locale parity, production build, relevant Vitest suites, backend regression
  tests, Playwright smoke, manual browser inspection, and both documentation
  gate runs pass.

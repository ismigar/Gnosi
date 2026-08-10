# Directive: Sidebar Section Heading Unification

## Objective

Use one visual contract for navigation section headings and navigation rows in
every Gnosi application sidebar. The Mail sidebar headings are the reference:
compact, bold, uppercase, and colored with the shared secondary text token.

The authoritative frontend remains
`monorepo/apps/gnosi/frontend/src/`, served by the native Vite runtime.

## Scope

- Define the shared heading contract in the global design-system stylesheet.
- Apply it to navigation groups in Mail, Vault, Calendar, Reader, Media,
  Settings, and Graph sidebars.
- Preserve route-specific layout, disclosure controls, spacing, and actions.
- Remove redundant active-vault identity rows from feature sidebars when the
  shared application header already exposes the active vault.

## Visual contract

- Eleven-pixel type with a bold weight and the application sans-serif family.
- Uppercase text with moderate letter spacing and a compact line height.
- Shared secondary text color in both light and dark themes.
- Interactive headings may change to the primary text color on hover and
  focus, but their resting typography remains identical to static headings.

## Navigation row contract

- Feature sidebars define their font family, row size, and line height once on
  the sidebar root and expose semantic row classes for normal, compact, and
  detail levels.
- Equivalent entries use the same semantic row class regardless of whether
  their interactive container is a button, div, or link.
- Favorites, dashboards, and wiki page trees use the same normal row level.
- Compact and detail levels are reserved for genuinely nested database and
  view information, preserving a consistent proportional hierarchy.
- Flat rows inside tree-like sections reserve the same disclosure column as
  expandable rows, so their icons and labels share one horizontal grid.
- Nested tree levels add one consistent indentation step to that base grid.
- Normal navigation rows use one shared height and lists use one shared gap;
  compact and detail rows use explicit proportional heights from the same
  scale.

## Verification

- Run the frontend production build and the relevant focused tests.
- Verify locale catalog parity when translation keys change.
- Inspect Mail plus representative Vault, Calendar, Reader, Media, Settings,
  and Graph sidebars in the native browser runtime.
- Confirm the Mail sidebar no longer shows a duplicate active-vault row.
- Confirm every visible section heading has the same computed font size,
  weight, letter spacing, text transform, line height, and color token.
- Check light and dark themes and compact layouts for clipping or lost actions.

## Restrictions and edge cases

- Do not restyle page titles, form labels, menu headings, tabs, table headers,
  metadata, or content headings as sidebar navigation headings.
- Do not translate user data or account, vault, folder, and tag names.
- Do not remove the shared header vault badge; only remove duplicate identity
  rows inside feature navigation sidebars.
- Do not replace collapsible headings with static text or remove their
  accessible expanded state.
- Do not hard-code light-theme colors; use shared theme variables.
- Do not make route-specific copies of the canonical typography declaration.
- Do not rely on a Tailwind font-size utility on a button to establish sidebar
  row typography. The unlayered global form reset can make that button inherit
  the parent size while an equivalent div keeps the utility size; use the
  semantic sidebar row class instead.
- Do not pass Jest's `--runInBand` option to the frontend test command because
  Vitest rejects it; use the repository's plain `npm test` script.
- Do not use an ad-hoc padding value for flat favorites. It drifts from the
  dashboard and wiki tree grid; use the shared tree-leaf inset instead.
- Do not mix per-component vertical padding with icon controls that have their
  own minimum height. That makes rows with actions taller than plain rows; set
  row height and list gap through the sidebar contract.
- The full frontend suite can currently fail in the unrelated model comparison
  registry expectation (`[0]` versus `[0, 1]`). Report that baseline failure
  separately and still run focused sidebar checks, lint, and the production
  build; do not change model routing as part of sidebar work.

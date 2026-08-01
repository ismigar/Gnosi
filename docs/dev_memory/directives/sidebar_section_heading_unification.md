# Directive: Sidebar Section Heading Unification

## Objective

Use one visual contract for navigation section headings in every Gnosi
application sidebar. The Mail sidebar headings are the reference: compact,
bold, uppercase, and colored with the shared secondary text token.

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


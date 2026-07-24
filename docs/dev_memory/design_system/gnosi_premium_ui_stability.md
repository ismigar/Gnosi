# Gnosi UI Stability

## Product identity

The product name is Gnosi. Use the current square G mark and shared design
tokens.

## Routing

- `/` loads `HomePage`.
- `/dashboard` is a technical monitoring surface, not the landing page.

## Canonical components

- Use `AppSidebar.jsx`.
- Use `HomePage.jsx` for the main home experience.
- Remove or ignore obsolete duplicate components only after confirming no live
  imports.
- Implement state through the variables and theme rules in `index.css`.

## Language

All interface text uses i18n. English is the fresh-install default and every
supported locale contains each key.

## QA

Before completion:

1. Run the frontend production build.
2. Verify the current logo.
3. Verify `/` loads HomePage.
4. Check light/dark theme and responsive navigation.
5. Confirm no obsolete duplicate component is imported.

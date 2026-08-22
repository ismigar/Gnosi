# Directive: Adaptive Application Sidebar Navigation

## Objective

Keep the global application sidebar usable when the number of built-in features
and plugin contributions exceeds the available viewport height. The sidebar must
continue to expose the current route, core actions, and every enabled app
without clipping controls below the viewport.

## Information Architecture

- The logo/header and footer actions remain fixed.
- The central rail is the only vertically scrollable area. It must use a
  constrained flex height (`min-height: 0`) and contain overscroll so page
  scrolling does not leak through it.
- A persistent access button opens a compact secondary rail to the right of the
  main rail. It contains the same icon buttons and exposes only enabled
  destinations that are not already visible in the main rail, avoiding
  duplicate navigation controls.
- Users pin, unpin, search, and reorder destinations in Settings → Menu. The
  active destination must remain visible in the main rail for the current
  session even if it is unpinned.
- New destinations are available from the launcher by default. The built-in
  destinations retain their existing default order so existing users do not
  lose familiar navigation.
- Preferences live under the existing per-vault plugin settings persistence as
  the shell-owned `app-sidebar` namespace. They contain only route identifiers
  and must discard unknown, disabled, or duplicated routes during hydration.

## Accessibility and responsive behaviour

- The quick-access rail is a labelled menu with semantic links, Escape and
  outside-click dismissal, and supplementary tooltips. Settings → Menu owns the
  labelled search field and accessible pin/reorder controls.
- Keyboard shortcuts continue to navigate the complete visible destination
  list; they are not reassigned by pinning.
- On compact layouts, the rail remains scrollable and the launcher exposes
  names as well as icons. Tooltips remain supplementary only.
- Use translation keys for every visible string in Catalan, English, Spanish,
  and French. Code comments, logs, and documentation remain English.

## Verification

- Unit-test default ordering, preference normalization, pinning, unpinning,
  reordering, active-route visibility, and launcher filtering.
- Run focused frontend tests, lint, the production build, and locale parity
  checks.
- Inspect the native browser at a short viewport height: the rail scrolls,
  footer controls remain visible, quick access lists all routes, an unpinned
  item opens correctly, and Settings → Menu persists pinning and order.

## Restrictions and edge cases

- Do not reserve a scrollbar gutter on only one side of the application rail.
  It shifts the scrollable application menu away from the fixed footer menu;
  use a stable gutter on both edges so both icon groups share one vertical axis.
- Do not combine application access and menu configuration in a large modal.
  It turns a frequent navigation action into a management workflow; use the
  compact secondary rail for access and Settings → Menu for configuration.
- Do not repeat pinned or temporarily active destinations in quick access. It
  adds visual noise without increasing reachability; hide the access trigger
  entirely when the main rail already contains every enabled destination.

- Do not hide a destination merely because it cannot fit in the rail; it must
  remain reachable from the launcher.
- Do not persist React component references, translated labels, or user names;
  persist only stable route identifiers.
- Do not store global sidebar preferences in an arbitrary browser-only key.
  The vault plugin settings endpoint is the source of truth and supports
  synchronized vault configurations.
- Do not allow a plugin to inject raw DOM into the rail. Contributions use the
  normal registered destination/permission path and are filtered by enabled
  state before rendering.

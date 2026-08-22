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
- A persistent application launcher opens a searchable, labelled list of all
  enabled destinations. This is the discovery path for apps that are not
  currently pinned to the compact rail.
- Users can pin or unpin destinations and reorder pinned destinations from the
  launcher. The active destination must remain visible in the rail for the
  current session even if it is unpinned.
- New destinations are available from the launcher by default. The built-in
  destinations retain their existing default order so existing users do not
  lose familiar navigation.
- Preferences live under the existing per-vault plugin settings persistence as
  the shell-owned `app-sidebar` namespace. They contain only route identifiers
  and must discard unknown, disabled, or duplicated routes during hydration.

## Accessibility and responsive behaviour

- The launcher is a labelled dialog with a real search field, explicit close
  action, semantic links, and accessible pin/reorder controls.
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
  footer controls remain visible, the launcher lists all routes, and a
  selected unpinned item opens correctly.

## Restrictions and edge cases

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

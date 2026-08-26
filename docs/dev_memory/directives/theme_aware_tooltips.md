# Directive: Theme-Aware Tooltips

## Objective

Every application tooltip must follow the effective Gnosi appearance: light,
dark, or the operating-system preference when Settings uses system mode.
Tooltip text must remain localized and accessible to keyboard and assistive
technology users.

## Scope

- Replace browser-native tooltip presentation from HTML `title` attributes
  with one application-level themed tooltip layer.
- Keep `aria-label`, `alt`, and other accessible names as semantic content;
  they must not be removed or visually repurposed.
- Preserve richer tooltips that already render their own markup, such as
  navigation shortcuts, graph legends, and document previews.
- Use shared semantic color, border, shadow, and keyboard-key tokens for every
  tooltip implementation.

## Plan

1. Define tooltip tokens for the light theme and override them in the existing
   dark-theme root class.
2. Add one global tooltip layer that adopts dynamically rendered `title`
   attributes, suppresses the unstyleable native browser bubble, and responds
   to hover, focus, Escape, scrolling, and viewport changes.
3. Keep tooltip content associated with its trigger through ARIA while it is
   visible, without replacing existing accessible names.
4. Exclude triggers that contain an existing rich tooltip from the global
   visual layer while still suppressing their duplicate native bubble.
5. Migrate the existing sidebar and row-action tooltip styles to the shared
   tokens.
6. Add focused unit coverage for dynamic titles, keyboard behavior, rich
   tooltip exclusion, and cleanup.

## Restrictions and edge cases

- Do not try to style the browser's native `title` popup; browsers do not expose
  it to application CSS. Move its content to application-owned markup instead.
- Do not derive visible tooltips automatically from `alt` text. Alternative
  text describes image content and must remain available when images fail or
  to assistive technology; using it as generic hover help changes its meaning.
- Do not remove existing `aria-label` or `aria-describedby` values. Any
  temporary tooltip relationship must be appended and restored exactly.
- Do not remove a `title` that is the only accessible name of an icon control
  without preserving that name as a generated `aria-label`. Controls with
  visible text or an explicit accessible name must keep their existing naming.
- Do not show a second tooltip when a trigger already contains a rich tooltip
  owned by the component.
- Do not leave a tooltip visible after pointer activation or a native context-menu
  request; it can cover the first item in a newly opened menu. Dismiss activation
  events during capture because menu triggers commonly stop propagation.
- Portal-based and lazy-loaded content must be covered after initial render.
- System appearance is resolved by the existing `useTheme` hook and the
  document's effective `.dark` class; tooltip code must not maintain a second
  theme preference.

## Required validation

1. Run focused tooltip unit tests.
2. Run frontend lint, the complete unit suite, and the production build.
3. In the native HTTPS application on port 5173, verify one ordinary `title`
   tooltip and one rich navigation tooltip in explicit light and dark modes.
4. Verify system mode follows the effective operating-system appearance.
5. Confirm hover and keyboard focus both expose the tooltip and Escape closes
   it without leaving a native browser bubble.

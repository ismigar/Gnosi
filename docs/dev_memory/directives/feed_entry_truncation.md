# Directive: Feed entry truncation

## Objective

Embedded feed entries collapse bodies longer than about 25 lines and expose
i18n-backed Expand and Collapse actions, matching Notion-style behavior.

## Scope

Implement in `FeedItem` inside `DbViewEmbed.jsx`. Full-screen
`VaultFeed.jsx` does not render entry bodies and is out of scope.

## Implementation

1. Define a pixel threshold derived from the actual text size and line height,
   approximately 570 px for 25 lines.
2. Measure an unclipped content element through `offsetHeight`. Apply
   `max-height` and `overflow: hidden` to its parent so `ResizeObserver` still
   sees late-loading images change the real height.
3. Show a down or up arrow only when content exceeds the threshold.
4. Add a non-interactive gradient at the bottom of collapsed content.

## Restrictions

- Do not use `-webkit-line-clamp`; mixed Markdown blocks break under its box
  layout.
- Do not observe the clipped element because its border box remains fixed.
- `bodyOverflows` is monotonic for a mounted item: once true, never reset it
  to false. Late image loading can oscillate around the threshold and cause a
  Safari flicker if clipping toggles repeatedly.
- Expansion state is intentionally per component instance and not persisted.

## QA

- Build and lint pass.
- Long content collapses and expands; short content has no action.
- Wikilinks, images, and headings remain interactive and correctly laid out.

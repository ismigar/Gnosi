# Live Page Links Graph

> ID: `PAGE-LINKS-GRAPH-2026-07-28`
> Status: active

## Objective

Show a compact graph inside the page links panel with the current page at its
center and every directly connected page around it.

## Sources of truth

- Outgoing wikilinks come from the editor document and update as soon as the
  set of links changes.
- Incoming wikilinks and schema relations come from the existing backlinks and
  outlinks requests.
- The graph derives entirely from the same React state used by the textual
  lists. It must not fetch a second copy of the same data.

## Interaction

- Connected nodes open the same parallel page pane as the textual link chips.
- Nodes are keyboard focusable and activate with Enter or Space.
- Node labels are shortened to fit the graph; the native hover title and
  accessible label retain the complete page title.
- Colors distinguish outgoing links, incoming links, and schema relations.
- When a page belongs to more than one connection type, its node and edge use a
  mixed state and the tooltip reports every type.

## Layout

- Use a deterministic concentric-ring layout so changes do not start a worker
  or make unrelated nodes jump unpredictably.
- Deduplicate connected pages by canonical page ID. Keep unresolved outgoing
  targets distinct by normalized title.
- Render every page as one compact, filled node, consistent with the global
  graph. The current page is larger, but it does not use a separate inner core
  or translucent outer sphere.
- Scale the SVG height by the number of rings and keep a responsive view box.
- Keep the graph compact enough to remain an overview above the detailed
  textual lists.

## Restrictions and edge cases

- Do not reuse the global Sigma graph because it adds a full graph request,
  physics worker, and global filters to a local one-hop view.
- Do not update the parent on every editor keystroke because that rerenders the
  full page editor. Compare the outgoing-link signature and publish only when
  the link set changes.
- Do not replace full titles in application state with truncated values.
  Truncation is presentational only.
- Do not create clickable graph nodes for unresolved outgoing targets.
- Do not represent page nodes as a small core inside a larger translucent
  circle. The extra layer has no semantic meaning and diverges from the global
  graph's compact-node vocabulary.
- Do not export graph-model helpers from the React component module because
  the Fast Refresh lint rule rejects mixed component and utility exports. Keep
  pure helpers in a separate model module.
- All user-visible labels must exist in all four locales.

## QA

Run the graph-model unit tests, i18n validation, frontend build, and browser QA.
In the browser, verify the center page, direct nodes, legend, full hover title,
keyboard focus, node navigation, and immediate add/remove updates.

# Vault Record Hover Scroll

## Objective

Every hover preview representing a Vault record must keep its content inside
the viewport and provide one vertical scrolling contract across table titles,
other database views, wikilinks, and citations.

## Scope

- `PageHoverCard` is the shared full-record preview used by table, gallery,
  board, timeline, feed, and calendar titles.
- `WikilinkHoverPreview` is the compact record preview used by wikilinks and
  citations inside record content.
- Both use the shared layout and keyboard-scroll utilities in
  `hoverPreviewLayout.js`.

## Interaction contract

- The content region scrolls vertically when its rendered content exceeds the
  viewport-safe card height.
- The card and its content never expose horizontal scrolling. Long words,
  preformatted text, code, and tables wrap or stay constrained to the card.
- Moving the pointer into an overflowing card focuses its content region without
  moving the document viewport.
- Arrow Up and Arrow Down scroll by a stable small step. Page Up and Page Down
  scroll by most of the visible content height. Home and End move to the start
  and end.
- Keyboard events consumed by the preview do not leak into table cell or view
  navigation.
- Leaving the card restores the previously focused element when possible.
- The full preview retains its Escape and Space Quick Look close behavior.

## Execution

1. Keep viewport sizing and key-to-scroll calculations in shared pure helpers.
2. Apply the helpers to both record-hover components.
3. Keep the title or header fixed while only the record content scrolls.
4. Add unit coverage for every supported navigation key and scroll boundary.

## QA

1. Run the focused Vitest suite for hover-preview layout and keyboard scrolling.
2. Run the production frontend build with zero errors.
3. In the native app on HTTPS port `5173`, hover a long record title and a long
   wikilink/citation preview.
4. Verify visible vertical overflow, mouse-wheel scrolling, Arrow Up/Down,
   Page Up/Down, Home/End, and the absence of horizontal overflow.

## Restrictions and edge cases

- Do not rely only on the browser's implicit focused-element scrolling; parent
  grid handlers can consume cursor keys. Handle supported scroll keys explicitly
  and stop propagation.
- Do not focus a short, non-scrollable hover merely because the pointer enters;
  that would steal arrow navigation without providing scrolling.
- Do not put `overflow-y-auto` on a child without a constrained flex height;
  it can grow to its content and never become scrollable. Use a `min-height: 0`
  flex content region under the card's viewport-safe maximum height.

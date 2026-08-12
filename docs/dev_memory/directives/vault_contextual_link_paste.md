# Contextual Link Paste

## Objective

When a user pastes one HTTP or HTTPS URL into an empty Vault editor block,
offer a compact, keyboard-accessible choice between a mention, an embed, a
bookmark, and a plain URL. Keep the interaction next to the caret instead of
opening a modal.

## Behavior

- A URL pasted over selected text immediately turns that text into a normal
  link. It does not open the chooser.
- A URL pasted inside a non-empty text block keeps BlockNote's normal inline
  paste behavior.
- A URL pasted into an empty text block is intercepted in the DOM capture
  phase and opens the chooser before ProseMirror can insert duplicate text.
- Mention inserts a native wikilink when the URL identifies a Gnosi Vault
  page. External URLs become compact inline links using Open Graph title data
  when available and the hostname as a deterministic fallback.
- Embed uses the existing embed block and renderer.
- Bookmark uses the existing link-card block and Open Graph preview endpoint.
- URL inserts a conventional inline link whose visible text is the URL.
- Escape or an outside pointer press closes the chooser without changing the
  document. Arrow keys move through the choices and Enter applies one.

## Persistence

Do not introduce a second link-card or embed serialization format. Bookmark
continues to round-trip through the existing bookmark Markdown marker, embed
continues through the existing embed marker, native page mentions continue as
stable-ID wikilinks, and compact external mentions remain ordinary portable
Markdown links.

## Restrictions and edge cases

- Do not intercept pasted files, multi-line text, non-HTTP schemes, or text
  that merely contains a URL.
- Do not leave the empty anchor paragraph before a block representation;
  replace the current empty block through BlockNote's slash-menu insertion
  helper.
- Restore the captured block before applying a choice so clicking the chooser
  cannot move the insertion point elsewhere.
- Keep preview lookup failure non-blocking. A failed request must still insert
  a compact mention using the URL hostname.
- Keep every visible label in all four frontend locale catalogs.
- Do not replace the existing rich-link modal; it remains the explicit flow
  for local paths, uploads, and media files.
- Keep the embed block fluid through every BlockNote wrapper so external frames
  fill the available page or column width; intrinsic renderer sizing leaves a
  narrow frame with unused space beside it.
- Do not define callbacks that close over the BlockNote editor before the
  `useCreateBlockNote` declaration. JavaScript's temporal dead zone causes a
  runtime ReferenceError even though the production build succeeds; place
  editor-dependent callbacks after editor creation or access the stable ref.

## QA

1. Run focused unit tests for URL recognition, internal-page extraction, and
   chooser keyboard and pointer behavior.
2. Run the frontend production build and i18n validation.
3. In the native HTTPS frontend on port 5173, use a disposable page or restore
   the edited page after the test. Verify all four choices, selected-text
   linking, Escape cancellation, and conversion persistence after reload.
4. Confirm bookmark preview failure falls back gracefully and the browser
   console has no new errors.

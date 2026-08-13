# Nested Vault Callouts

**Status:** active
**Date:** 2026-08-13
**Scope:** `monorepo/apps/gnosi/frontend/src/components/Vault/`

## Objective

Provide a slash-menu Callout command whose result is a real block container.
Every block type supported by the Vault editor can be placed inside it,
including paragraphs, headings, lists, tables, columns, files, media, embedded
views, and nested callouts.

## Editor contract

- The Callout slash command replaces the current slash paragraph with a
  callout and creates an editable paragraph as its first child.
- The cursor lands in that first child so the user starts writing inside the
  callout immediately.
- The callout shell owns presentation only. Its contents remain ordinary
  BlockNote children and retain their complete schema and editing behavior.
- A callout may be moved, copied, deleted, and nested using the same structural
  operations as other blocks.
- The default callout is the neutral information variant. Existing warning,
  error, and success variants remain valid.

## Markdown contract

Nested callouts use a fenced Gnosi directive named `callout`, with the variant
stored as a `type` attribute. Content between the opening and closing fences is
parsed recursively through the normal rich-Markdown mapper. The serializer
indents child blocks and preserves nested structural directives.

Legacy Obsidian callouts beginning with `> [!type]` remain accepted. Their
quoted body is promoted to normal child blocks when loaded and is subsequently
saved in the fenced container form.

## Restrictions and edge cases

- Do not store the body as inline content on the callout block. That makes
  headings, columns, files, and other block nodes impossible to represent.
- Do not flatten child blocks during serialization. Flattening destroys layout,
  file blocks, embedded views, and nested callouts.
- Promote serialized file, audio, and video links recursively after Markdown
  parsing. The base Markdown parser otherwise turns media inside any container
  into ordinary paragraph links on reload.
- Do not style only the callout's marker node. The visual shell must encompass
  its descendant block group while leaving nested block controls interactive.
- Do not select a React callout as a direct `.bn-block-content` child of
  `.bn-block`. BlockNote inserts a `.react-renderer` wrapper, so that selector
  leaves the shell transparent. Target the wrapper-aware hierarchy and keep the
  nested `.bn-block-group` inside the same styled outer block.
- Never create a callout without at least one editable paragraph child. An
  empty structural container gives the user no reliable caret target.
- Malformed or unknown callout variants fall back to `info`; they must not make
  the page schema invalid.
- Closing-fence detection must count nested callouts, columns, and toggles at
  the same recursive depth. Otherwise an inner fence can truncate its parent.

## Verification

1. Unit-test serialization and parsing with headings, columns, files, and a
   nested callout.
2. Unit-test legacy Obsidian callout migration.
3. Build the frontend without warnings or type/schema errors.
4. In the native browser, insert `/callout`, verify the caret starts inside,
   then add a heading, columns, and a file block inside the same visible shell.
5. Reload the page and verify the complete hierarchy and visual containment
   survive the Markdown round trip.

# Contextual Markdown Round-Trip Escaping

**Status:** active
**Date:** 2026-06-23
**File:** `frontend/src/components/Vault/markdown-mapper.js`

## Problem

Unstyled text was serialized literally. Markdown punctuation could be
reinterpreted after save and reload, silently changing plain text into
emphasis, code, links, headings, quotes, lists, or thematic breaks.

## Design

Use minimal contextual escaping, not blanket escaping. The stored Markdown
must remain readable in Obsidian while preserving the user's literal text.

Escape only unstyled text nodes. Styled text, code spans, and code blocks retain
their own balanced syntax.

## Inline rules

Process literal backslashes first so the operation remains idempotent.

- Escape every literal backslash.
- Escape every backtick in unstyled text.
- Escape `*` only when CommonMark flanking rules would create emphasis.
- Escape `_` under the same rules while preserving harmless intraword
  underscores such as `my_var_name`.
- Escape `~` when it forms a strike-through delimiter.
- Escape the opening bracket only when it would form an inline link or image.
- Leave standalone reference-like brackets literal when the parser already
  preserves them.

Treat text-node boundaries as whitespace for flanking calculations. BlockNote
normally merges adjacent unstyled runs, while styled runs emit their own
balanced delimiters.

## Line-start block markers

Only paragraph and list-item text receives line-start escaping. For every line,
escape markers that would become:

- ATX headings
- Block quotes
- Bulleted or numbered lists
- Thematic breaks
- Setext headings

Do not apply line-start rules inside headings, callouts, columns, toggles, or
table cells.

## Restrictions

- Never escape code-block content.
- Do not pass wikilinks, citations, or transclusions through the plain-text
  escaper; they have dedicated serializer branches.
- Do not escape intentional serializer HTML such as `<br>`, `<u>`, or layout
  wrappers.
- Table cells use their own parser and escape only pipe separators.
- Round-trip must be idempotent: serialize(parse(serialize(parse(input)))) must
  stabilize without accumulating backslashes.

## HTML table boundary repair

A CommonMark type-6 HTML block opened by a standalone `<table>` ends only at a
blank line. Without a blank line after `</table>`, subsequent Markdown can be
swallowed as raw HTML.

`parsePlainMarkdownBlock` inserts a blank line after a standalone closing table
tag when one is missing. It does not modify inline table HTML.

Browser QA must prove links before and after both repaired and already-correct
tables render as links.

## Known separate limitation

Soft line breaks inside a text node are not fully idempotent. The serializer
emits `<br>` and the parser can expand it into additional breaks and spaces on
subsequent cycles. This predates contextual escaping and requires a separate
soft-break fix.

The escaping change still prevents a line following a soft break from being
promoted to a structural Markdown block.

## QA

Use an isolated editor instance and verify stable round-trips for:

- Double underscores
- Emphasis delimiters
- Literal backticks
- Harmless intraword underscores
- Arithmetic asterisks with spaces
- Links and standalone references
- Wikilinks, citations, and transclusions
- Tables and callouts
- Every line-start marker

Do not type into real notes during automated QA because WebSocket autosave can
write to disk.

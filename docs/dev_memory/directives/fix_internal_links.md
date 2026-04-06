# Directive: Fixing Internal Links (Wikilinks) in Gnosi

## Status
Staging - Under Development

## Context
The Gnosi vault editor uses BlockNote. The user wants Obsidian-style internal links `[[Page Title]]`. 
Currently, the suggestion menu triggered by `[` inserts `[[Page Title]]` as plain text, so it's not clickable as a link in the editor.
Also, the markdown mapper doesn't handle the conversion between BlockNote link objects and the `[[Page Title]]` syntax properly.

## Goals
1.  Ensure that selecting a page from the suggestion menu inserts a functional link in the editor.
2.  Maintain the `[[Page Title]]` format in the saved Markdown files for compatibility with Obsidian.
3.  Ensure the editor renders these links with the specific "wiki link" style (blue background/text).

## Implementation Rules

### 1. Editor Insertion (BlockEditor.jsx)
-   `insertWikiLink` must create a BlockNote `link` inline content object.
-   The `href` should follow the pattern `/vault/page/{id_or_title}`.
-   The `content` of the link should be the literal `[[Title]]` (or just `Title` if we want, but the user seems to want the brackets visible in the editor too, or at least they mentioned it "writes the title in [[]]").
-   Actually, for a better UX, we could use `Title` as content and `[[Title]]` only in Markdown, BUT the user specifically said "escriu el títol en [[]]", so they might prefer seeing the brackets.

### 2. Markdown Mapping (markdown-mapper.js)
-   **Serializing**: When converting from BlockNote to Markdown, if a link's `href` starts with `/vault/page/`, it should be converted to `[[Title]]` (or `[[Title|Alias]]`) instead of `[Title](href)`.
-   **Parsing**: When converting from Markdown to BlockNote, the parser should detect `[[Title]]` patterns and convert them to BlockNote `link` objects with `href="/vault/page/Title"`.

## Restrictions
-   Do not use plain `text` for links in the editor; they must be `type: "link"` to be interactive.
-   Ensure `encodeURIComponent` is used for IDs/Titles in `href`.
-   Handle `[[Title#Section]]` and `[[Title|Alias]]` variants.

## Edge Cases
-   **Missing Pages**: If a link points to a page that doesn't exist, it should still be a link (broken link style if possible, but at least a link).
-   **Duplicate Titles**: Use IDs in `href` when available to avoid ambiguity.

## Validation Protocol
1.  Type `[[` in the editor.
2.  Select a page from the list.
3.  Verify the inserted text is blue/clickable.
4.  Save the page and check the Markdown output (should be `[[Title]]`).
5.  Reload the page and verify the link is still functional in the editor.

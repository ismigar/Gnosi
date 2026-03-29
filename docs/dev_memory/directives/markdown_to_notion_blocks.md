# IMPERATIVE: Markdown to Notion Blocks Conversion

## Objective
The goal is to parse a JSON response (often wrapped in Markdown code blocks) containing a translated body in Markdown, and convert that Markdown body back into a list of Notion blocks. This allows specific formatting (bold, italic, links) to be preserved when writing back to Notion.

## Input Specification
The input is an array of items, where each item has an `output` field.
The `output` field is a string containing a JSON object, usually wrapped in markdown code fences (```json ... ```).

Structure of the inner JSON:
```json
{
  "lang": "EN-GB",
  "title": "Translated Title",
  "imatge_alt_text": "Translated Alt Text",
  "body": "Markdown text with **bold**, *italic* and [links](url)."
}
```

## Logic Flow

1. **Clean and Parse JSON**:
   - Remove "```json" and "```" wrappings from the `output` string.
   - Parse the clean string into a JSON object.

2. **Extract Fields**:
   - Extract `lang`, `title`, `imatge_alt_text`.
   - Extract `body` (Markdown string).

3. **Convert Markdown Body to Blocks**:
   - Split the `body` string by double newlines (`\n\n`) to identify paragraphs.
   - For each paragraph:
     - Create a Notion block of type `paragraph`.
     - specific parser to convert Markdown tokens into Notion `rich_text` array.

4. **Markdown Parsing Rules (Rich Text)**:
   - **Bold**: `**text**` -> `annotations: { bold: true }`
   - **Italic**: `*text*` or `_text_` -> `annotations: { italic: true }`
   - **Link**: `[text](url)` -> `link: { url: "url" }`
   - **Plain**: Everything else is plain text.
   - **Order**: Maintain the exact order of text segments.

## Output Specification
An array of objects, one per input item.
Each object should contain:
- `lang`
- `title`
- `imatge_alt_text`
- `blocks`: An array of Notion block objects.

Example Block Structure:
```json
{
  "object": "block",
  "type": "paragraph",
  "paragraph": {
    "rich_text": [
      {
        "type": "text",
        "text": { "content": "This is " },
        "annotations": { "bold": false, "italic": false, ... }
      },
      {
        "type": "text",
        "text": { "content": "bold" },
        "annotations": { "bold": true, "italic": false, ... }
      }
    ]
  }
}
```

## Restrictions & Edge Cases
- **Nested Formatting**: Attempting to handle nested formatting (e.g., `**bold _italic_**`) can be complex. For this version, assume standard non-nested markdown or prioritize the outer tag if regex is simple. *Self-correction: A simple regex tokenizer is preferred over a full parser for stability.*
- **Malformatted JSON**: The LLM output might be dirty. Ensure robust stripping of backticks.
- **URLs in Links**: Ensure URLs are correctly extracted.

## Testing Protocol
- Use the user-provided sample input.
- Verify that `**` becomes bold, `*` becomes italic, and `[]()` becomes a link.

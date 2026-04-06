---
name: notion_formatting
description: Conversion utilities for Notion Rich Text <-> Markdown preserving generic format.
---

# Notion Formatting Skill

## Purpose
To maintain rich text formatting (Bold, Italic, Links, Code) when processing Notion content via LLMs or external systems. The pipeline converts `Notion Blocks` -> `Markdown` -> `Processing (LLM)` -> `Markdown` -> `Notion Blocks`.

## Core Logic

### 1. Notion Blocks -> Markdown
Logic located in `pipeline/notion_api.py` (`rich_text_to_markdown` / `_process_blocks_recursive`).
- **Bold**: `**text**`
- **Italic**: `*text*` (or `_text_`)
- **Code**: `` `text` ``
- **Link**: `[text](url)`
- **Headings**: `#`, `##`, `###`
- **Lists**: `- `, `1. `

### 2. Markdown -> Notion Blocks
New logic required (Javascript for n8n, Python for validation).
Must support parsing the markdown tokens back into Notion `rich_text` objects.

#### Regex Strategy (Simplified)
```regex
/(\*\*.*?\*\*|_.*?_|`.*?`|\[.*?\]\(.*?\))/g
```
Iterate over matches to build the `rich_text` array.

## Scripts
- `scripts/verify_conversion.py`: Python script to read a Page, Convert to MD, Parse back to Blocks, and Write to a new Page. Verification of fidelity.

## n8n Implementation
- **Input Node**: `PrepareNotionTranslate` (JS) - Already implements `richTextToMarkdown`.
- **Output Node**: `TranlationUnpaker` (JS) - Needs robust `markdownToRichText`.
- **Loader**: `AppendNotionBlocks` (HTTP) - Needs to accept block structures, not just plain text.

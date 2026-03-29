# Directive: Notion Blocks to HTML & Markdown Transformation

# DIRECTIVE: transform_notion_blocks

> ID: 20260126_transform_notion
> Associated Script: pipeline/sandbox/transform_notion_blocks.py
> Last Update: 2026-01-26
> Status: ACTIVE
> 

---

## 1. Objectives and Scope

*Describe here WHAT this task should achieve and WHY.*

- **Main Objective:** Create a robust function to transform Notion Blocks (JSON) into both HTML and Markdown formats, preserving rich text annotations (bold, italic, strikethrough, code, underline, links).
- **Success Criteria:** The output object for each item must contain `html_body` (string) and `markdown_body` (string) with correct formatting.

## 2. Input/Output (I/O) Specifications

*Strictly define data types to ensure determinism.*

### Inputs

- **Required Arguments:**
    - `data`: [JSON Object] - A list of n8n items. Each item optionally contains a `blocks` array or `page_id` + `blocks` structure.
- **Source Files:**
    - `monorepo/apps/digital-brain/pipeline/backups/n8n/...json`: Reference input data.

### Outputs

- **Generated Artifacts:**
    - N/A (The script output is printed to console/stdout for n8n consumption).
- **Console Output:**
    - JSON array of objects, each containing the original data plus `html_body` and `markdown_body`.

## 3. Logical Flow (Algorithm)

1. **Initialization:** Parse input JSON.
2. **Preprocessing:** Locate the `blocks` array for each item. It might be directly in the item or nested under a parent page.
3. **Transformation (Iteration):**
    For each block in the array:
    - Identify block type (paragraph, heading_1, heading_2, heading_3, bulleted_list_item, numbered_list_item, quote, code, divider).
    - Extract `rich_text` content.
    - **HTML Generation:**
        - Apply tags: `<b>`, `<i>`, `<s>`, `<code>`, `<u>`, `<a>`.
        - Handle lists: Maintain a stack to open/close `<ul>` and `<ol>` tags correctly.
    - **Markdown Generation:**
        - Apply formatting: `**bold**`, `*italic*`, `~strike~`, `` `code` ``, `[text](url)`.
        - Handle lists: Use `- ` for bullets and `1. ` for numbered lists.
4. **Aggregation:** Join all transformed blocks into single strings (`html_body`, `markdown_body`).
5. **Output:** Return the enhanced object.

## 4. Tools and Libraries

*Whitelist of allowed dependencies.*

- **Python libraries:** `json`, `sys`.
- **Node.js (for final n8n node):** Native JS.

## 5. Restrictions and Edge Cases

- **Limits:** Notion API pagination (blocks children) is not handled here; assumes all blocks are already present.
- **Formats:** Special characters in HTML must be escaped (`&` -> `&amp;`, etc.). Markdown characters should be handled carefully but strict escaping might not be needed if simple concatenation works for the user's destination (IA).
- **Unknown Blocks:** Ignore blocks with unsupported types or empty content.

## 6. Error Protocol and Learning (Live Memory)

*CRITICAL: This section is automatically updated after failures.*

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 26/01 | Initial Design | N/A | Starting with dual generation logic |

## 7. Examples of Use

```bash
# Standard execution
python monorepo/apps/digital-brain/pipeline/sandbox/transform_notion_blocks.py
```

# Directive: Notion Translation Prompt Preparation

# DIRECTIVE: prepare_notion_translate

> ID: 20260126_prepare_translate
> Associated Script: pipeline/sandbox/prompt_generation.py
> Last Update: 2026-01-26
> Status: ACTIVE
> 

---

## 1. Objectives and Scope

- **Main Objective:** Prepare the JSON payload and the prompt for the AI translator.
- **Success Criteria:** 
  - The `body` field in the translation payload must contain Markdown with preserved annotations (bold, italic, etc.).
  - Robust handling: Use pre-calculated `markdown_body` if available; otherwise generate it from `blocks`.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Input Item:** JSON object with `page_id`, `blocks` (array), optional `markdown_body`.
- **Target Languages:** Extracted from n8n structure (Drupal languages).

### Outputs
- **Output:** Array of objects, one per target language.
- **Fields:** `target_lang`, `ia_prompt` (string containing the JSON to translate), etc.

## 3. Logical Flow

1. **Extract Main Info:** `page_id`, `persistent_data`, `markdown_body`, `payload_to_translate`.
2. **Validate Input:** Ensure `markdown_body` is present (or default to empty string, but do not generate).
3. **Identify Target Languages:** Extracted from n8n structure (Drupal languages).
4. **Generate Prompt (Loop):**
   - Construct `toTranslate` object by spreading `payload_to_translate` and adding `lang` and `body` (from `markdown_body`).
   - Embed this object into the Prompt Template.
   - The Prompt Template must explicitly instruct the AI to respect Markdown syntax.

## 4. Restrictions and Edge Cases

- **Quotes:** Ensure the prompt string handling avoids escaping issues.
- **URLs:** The prompt includes a specific instruction NOT to translate URLs inside markdown links.
- **Dependency:** This node strictly depends on a previous node providing `markdown_body`.

## 5. Error Protocol

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 26/01 | Logic Split | Complexity in dual responsibility | Simplified to single responsibility (Prompting) |

---
name: translate-page
description: Translate a Vault page title and Markdown body into language children, updating existing translations and preserving Gnosi directives. Use for the explicit translate-page action or Markdown segmentation maintenance.
metadata:
  status: active
---

# Skill: translate_page

## Purpose

Translate the title and body of a Vault Markdown page into user-selected
languages. Create or update one child with `parent_id = page_id` for each language.
This is the full-document counterpart of
[translate_row](../translate_row/SKILL.md).

Only Vault Markdown pages are in scope. Reader PDFs are not.

## Trigger

The user selects **Translate page** from the `VaultShell` page menu.
`TranslateLanguagesModal` opens with `mode="page"` and sends:

```
POST /api/vault/skills/translate-page
Body: { page_id: str, target_languages: [str], button_action: "translate_page" }
```

## Architecture

The route in `backend/domains/vault/translation/routes.py` delegates through
the domain lifecycle to `page_service.py`. It loads the page, detects its source
language and translates its plain title and Markdown body. Existing translation
children are updated in place; missing languages are created through the page
write service. The historical `backend/api/vault_routes.py` export remains a
compatibility boundary, not a second implementation.

`scripts/markdown_segmenter.py` exposes:

- `translate_markdown(body, src, tgt, ...) -> (str, set[providers])`
- `translate_title(title, src, tgt, ...) -> (str, provider)`
- `detect_source_lang`, re-exported from `translate_row`

Provider routing is reused directly from `translate_row`; this module adds
Markdown-aware segmentation only.

## Markdown segmenter

The body uses enriched Markdown. The Python segmenter mirrors
`frontend/src/shared/editor/markdown-mapper/` so `richMarkdownToBlocks` can parse the result without
structural changes. It processes lines with a block-state machine:

- Pass through fenced blocks, including `gnosi-database` and `gnosi-view`;
  `:::` directives; complete `:::gnosi-ignore` blocks; `{{bibliography}}`;
  standalone `![[...]]` transclusions; horizontal rules; and table separators.
- Preserve headings, list markers, checklists, blockquotes, and callout
  indentation while translating only their text.
- Translate toggle labels and GFM table cells.
- Protect inline code, HTML tags, images, wikilinks, citations such as
  `[@key]` and `@key`, and link destinations with `XSEGnnnZZZ` tokens. Link
  display text is translated.

The executable contract is covered by
`scripts/test_markdown_segmenter.py` and the backend translation tests. Private
development directives are not required to use a public checkout.

## Providers and configuration

Use the same providers as `translate_row`: Softcatalà NMT for `en↔ca`,
Softcatalà Apertium for Catalan pairs, local OPUS-MT for `es↔fr`, public
Apertium APy, and DeepL as a configured fallback. Environment variables are
read from the process, Gnosi's local `.env`, or an explicitly configured
`GNOSI_SHARED_ENV_FILE`. UI-managed keys use secure storage. Primary pairs
work without extra configuration.

## Child page shape

```json
{
  "title": "<translated title>",
  "content": "<translated Markdown body>",
  "parent_id": "<source page id>",
  "metadata": {
    "translation_lang": "<ISO 639-1 code>",
    "translation_source_lang": "<detected source language>",
    "translation_origin_id": "<source page id>",
    "translation_provider": "softcatala_nmt | apertium_public | deepl | mixed | ..."
  }
}
```

Unlike `translate_row`, do not add `table_id`; the child is a normal page whose
location is selected by the page write service. Do not hardcode a folder name.

## Restrictions and edge cases

- Skip a target identical to the source language.
- Translate only the title when the page body is empty.
- V1 does not translate wikilink aliases or image alt text; preserve protected tokens and test enriched Markdown round trips before changing segmentation.
- The current implementation makes one HTTP request per segment. Long pages
  can hit public Apertium rate limits; batching is future work.
- Re-running updates existing language children instead of duplicating them. Preserve origin/language metadata, translated content and the `created`, `updated`, `skipped` response groups.
- Unit tests must fake providers. A real translation can send selected text to external services or download a local model; it is not an incidental documentation check.

## Quick test

```bash
cd Gnosi
python3 -m pytest pipeline/skills/translate_page/scripts/test_markdown_segmenter.py -v
```

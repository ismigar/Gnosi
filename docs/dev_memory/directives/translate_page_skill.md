# Full-Page Translation Skill

## Summary

The `translate_page` skill translates a vault Markdown page into one or more
languages. Each target becomes a child page whose title and body are translated
while Markdown structure remains valid.

PDF reader documents are outside this skill's scope.

## Components

- `pipeline/skills/translate_page/scripts/markdown_segmenter.py`
- `pipeline/skills/translate_page/SKILL.md`
- `POST /api/vault/skills/translate-page`
- `TranslateLanguagesModal.jsx`
- Page options in `VaultShell.jsx`
- Page-tree refresh in `VaultDashboard.jsx`

Provider calls and source-language detection reuse `translate_row`. Markdown
segmentation remains isolated in `markdown_segmenter.py`.

## Segmenter contract

The output must parse through `richMarkdownToBlocks` without damaging custom
Gnosi structures. Use a line-oriented block-state machine.

Preserve verbatim:

- Fenced code, including Gnosi database and view JSON.
- Directive boundaries and the complete body of `gnosi-ignore`.
- Bibliography directives.
- Standalone transclusions.
- Horizontal rules, table separators, and blank lines.

Translate only the label of a toggle directive.

For headings, lists, tasks, block quotes, and callouts, preserve indentation
and structural prefix while translating only visible text.

Translate GFM tables cell by cell and restore escaped pipes.

## Inline token protection

Before translation, replace fragile syntax with neutral tokens in this order:

1. Inline code.
2. HTML tags.
3. Images.
4. Wikilinks.
5. Citations.
6. Link URLs while leaving link labels translatable.
7. Acronyms.

Restore tokens case-insensitively after the provider response.

Version 1 intentionally does not translate image captions or wikilink aliases.
Emphasis marker movement remains a known machine-translation limitation.

## Created child

Always create through the standard page service, never by writing Markdown
directly.

Each child contains:

- Translated title and body.
- `parent_id` pointing to the source page.
- `translation_lang`
- `translation_source_lang`
- `translation_origin_id`
- `translation_provider`

Normal translated pages do not inherit a table ID.

## API

```json
{
  "page_id": "<uuid>",
  "target_languages": ["en", "es"],
  "button_action": "translate_page"
}
```

The editor role is required. Heavy synchronous translation work runs through
`asyncio.to_thread`.

## Restrictions

- Skip a target equal to the detected source language.
- An empty-body page still translates its title.
- Repeated execution currently creates new children; deduplication by origin
  and target language is future work.
- Never translate IDs, parent/table references, dates, tags, technical
  frontmatter, code, or internal directives.
- Preserve user-selected content language; English is the application default,
  not a forced translation target.
- A malformed directive can hang or corrupt the editor, so structural tests
  are mandatory.

## QA

1. Unit-test the segmenter with a fake translation function.
2. Cover code, tables, directives, links, assets, citations, wikilinks,
   transclusions, lists, callouts, and token restoration.
3. Call the endpoint against a disposable page.
4. Refetch the created children and parse their Markdown in the frontend.
5. Complete browser QA for language selection, progress, error, and tree
   refresh.

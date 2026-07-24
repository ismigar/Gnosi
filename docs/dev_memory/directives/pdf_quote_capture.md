# PDF Quote Capture

> ID: `PDF-QUOTE-CAPTURE-20260528`
> Status: version 1 implemented; final browser E2E remains the completion gate.

## Objective

Convert a PDF highlight into Markdown blockquote text with a citation that
participates in the document bibliography.

Example output:

```markdown
> Captured annotation text.
>
> — [@author2024, p. 47]
```

## Existing components

- Integrated PDF reader.
- Local SQLite annotation persistence.
- Zotero-compatible highlight text, page index, and color.
- `PdfAnnotationsToCite.jsx`.
- PDF source URI helper.
- BlockEditor properties-panel integration.

## Source resolution

Resolve an associated PDF from the canonical attachment property or a
`file://` PDF URL. Normalize it to the source URI used by the annotation API.

Do not infer non-PDF URLs or expose arbitrary paths.

## UI

The first version displays a collapsible PDF Highlights section in the
Resource properties panel. Each useful annotation can be copied as quote
Markdown using the Resource citation key.

All labels, empty states, and errors use i18n with English defaults.

Optional future improvements:

- Drag a quote into the document.
- Better support for note-only annotations.
- Rich locator conventions driven by citation style.

## Restrictions

- A Resource without a PDF shows an informative localized state.
- Omit geometric highlights with no extracted text.
- Prefix every line of a multiline quote with `>`.
- Keep annotations local; do not send them to an external service.
- Preserve source language and exact selected text.
- Use Pandoc-compatible locator syntax where a page locator is included.

## QA

1. Associate a disposable Resource with a PDF.
2. Create a highlight.
3. Open the properties panel and copy the quote.
4. Paste it into a disposable document.
5. Verify blockquote rendering, citation resolution, locator, and bibliography.
6. Verify multiline and no-text annotation behavior.

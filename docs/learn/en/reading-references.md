# Capture sources, read and cite

Follow the research chain from a source to evidence and then to your own writing. Feed reading and reference management are separate features.

## Before you begin {#before-you-begin}

Enable Resources for reference management and Feeds Reader for feeds. Identifier lookup needs a network connection; Word and LibreOffice citations require the corresponding add-in.

## Steps {#steps}

1. Open **Literature search** (the Resources feature) and check the configured References table in its settings. Import a DOI, ISBN, arXiv or PMID identifier, a BibTeX/RIS file, or a supported web URL.

2. Review the imported title, authors, date and identifier before using the record. Resolve duplicate candidates rather than importing the same source repeatedly.

3. Open an attached PDF or EPUB. Make an annotation and retain its page, chapter or other source location; verify that the annotation points to the intended passage.

4. Create a reading note with the evidence and a separate paragraph containing your interpretation. Link it to the reference and to your project.

5. To follow feeds, activate Feeds Reader, add a feed in Reader and open an article. Feed content may still require access at the original publisher.

6. For a manuscript, install and configure the [Word add-in](https://github.com/ismigar/Gnosi/tree/main/extensions/office/word-cite) or [LibreOffice extension](https://github.com/ismigar/Gnosi/tree/main/extensions/office/libreoffice-cite). Use its citation picker and bibliography controls; check the resulting author, year and style.

## Expected result {#expected-result}

You have a verified reference, a traceable annotation and a note connected to your writing.

## Fields in generated notes {#generated-note-fields}

In **Settings → Plugins → Knowledge**, under each resource table, use **Fields to fill in reading notes → Add field**. Choose a Brain field and select **Infer with AI**, **Copy source field**, **Fixed value** or **Leave empty**. Removing a rule does not delete the table field. This selection is independent of indexed fields.

AI assigns values based on each note and only uses existing labels and relations. Fixed values respect the field type, including numbers, checkboxes and dates; attachments and other structured fields can be copied from the resource. Calculated and system fields are managed automatically. Rules apply when processing or reprocessing a resource. **Leave empty** clears the value in reprocessed notes; removing the rule preserves previous values.

## If something goes wrong {#troubleshooting}

An identifier supplies metadata, not guaranteed access to the full text. If import fails, check the identifier and provider, then try a supported file export. Inspect citation metadata before editing the rendered bibliography by hand.

## Related guides {#related-guides}

- [Ask questions about selected sources](notebooks.md)
- [Create pages, links and attachments](pages-files.md)

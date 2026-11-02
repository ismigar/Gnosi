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

### Fields in generated notes

In **Settings → Plugins → Knowledge**, under each resource table, use **Fields to fill in reading notes → Add field**. Choose a Brain field and select **Infer with AI**, **Copy source field**, **Fixed value** or **Leave empty**. Removing a rule does not delete the table field. This selection is independent of indexed fields.

AI assigns values based on each note and only uses existing labels and relations. Fixed values respect the field type, including numbers, checkboxes and dates; attachments and other structured fields can be copied from the resource. Calculated and system fields are managed automatically. Rules apply when processing or reprocessing a resource. **Leave empty** clears the value in reprocessed notes; removing the rule preserves previous values.

## If something goes wrong {#troubleshooting}

An identifier supplies metadata, not guaranteed access to the full text. If import fails, check the identifier and provider, then try a supported file export. Inspect citation metadata before editing the rendered bibliography by hand.

## Related guides {#related-guides}

- [Ask questions about selected sources](notebooks.md)
- [Create pages, links and attachments](pages-files.md)

## Listen to the daily podcast

With Feeds Reader enabled, configure the daily podcast in its plugin settings and the assigned assistant’s model in **Settings → AI**. The daily episode selects articles published in the preceding 24 hours. Unreadable sources are reported; if none can be read, no episode is published.

Personalize the assigned **Daily briefing** skill to adjust its editorial approach and podcast preferences. Defaults request ten minutes and at most twelve thematic groups. The default review checks the source briefs and thematic coverage, including smaller independent topics; the optional full review audits original fragments more extensively. Duration is a target, and generation can fail if it cannot meet the required length or evidence checks. Check the finished episode and its reported sources before relying on it.

Voice settings are shared by chat, Reader podcasts and generated audio within the active Vault. Changes save automatically; check the save status before previewing. A local voice must be available on the host, and neural speech requires its configured provider.

### Generation and recovery

Enable Feeds Reader and AI, configure the assistant assigned to the daily briefing skill, and check the voice settings. In Reader, use the podcast generation button; when an episode already exists, use its regenerate button. Open the voice panel below the player to preview speech, or use its **Open settings** button to edit the shared voice configuration. Preview is unavailable during generation.

The episode uses articles published in the preceding 24 hours, including articles already read. Articles with neither readable text nor a feed summary are omitted and reported. Generation can take several minutes; follow its progress and use Activity to inspect the task or cancel it. Listen to the completed episode in the player. An error or cancellation preserves the previous audio; if no article is readable, no replacement is produced.

Sparse days can produce shorter episodes. Settings changes apply to new jobs; a resumed job retains its original selection and preferences.

# Create pages, links and attachments

Use pages for your own ideas and keep the supporting material close to them. Gnosi stores knowledge in ordinary Markdown and YAML files.

## Before you begin {#before-you-begin}

An active Vault with write access. AI is optional; extra sharing and translation actions require their plugins.

## Steps {#steps}

1. Open Knowledge and create a page named “Reading project”. Add a heading, a short paragraph and a list of questions with the block editor.

2. Create a second page named “Source notes”. Use the page-link picker in the first page to insert a link to it; select the correct result when titles are similar.

3. Attach a small example document using the editor’s attachment controls. Open it again to check that the original file is available.

4. Add a quotation and record its source and location. Keep the quotation separate from your interpretation so that you can trace it later.

5. Leave the page and reopen it to verify autosave. Use search or the sidebar to return to it; follow the link to check the connection.

### Wide tables

In the page’s **⋯** menu, turn on **Free width** to let tables expand and scroll horizontally. Paragraphs keep a readable width. The preference is remembered for each page on this device and does not change the Markdown. Turn it off in the same menu to restore the usual layout.

### Search complete notes and reuse content

Global search finds words deep inside a note and shows a nearby excerpt. Use
`"exact phrase"`, `(red OR blue) -green`, `tag:research`,
`content:"working memory"`, `task-todo:review` or `[status:Draft]`.
`line:(red fox)`, `block:(red fox)` and `section:(red fox)` require both words
in the same line, block or section. Invalid queries display an error so you can
correct them. A **Search results** block, or a Markdown fence named `query`, keeps live
search results inside a note.

Write `![[Source notes]]` to display its full formatted content. Use
`![[Source notes#Heading]]` or `![[Source notes#^block-id]]` to embed a specific
part. Tables, code and nested notes are rendered; circular references stop with
an explanation. The source remains a separate note, and the embed refreshes
after changes.

The Markdown source editor includes highlighting, multiple cursors, Vim mode
and a rendered preview. Configure shortcuts in Settings and use Appearance to
save themes or CSS snippets. If a snippet makes the interface hard to use, open
Gnosi with `?gnosi-safe-appearance=1` and reset the appearance.

### Compose notes and save shortcuts

In a note’s **⋯** menu, choose **Compose notes**. Select the whole note, a heading or complete Markdown lines, then choose a new note or an existing destination. **Preview changes** shows the source, destination and affected links. Review every change before applying it. The source keeps an embed and its history. If another editor changes a file, prepare a fresh preview.

In the sidebar’s **Bookmarks**, save notes, sections, searches, graph views or web links and give them a group. The star on a note adds or removes that note from this same list. Former favorites and this device’s existing bookmarks are imported automatically, keeping custom names and groups. Bookmarks belong to the selected account, workspace and Vault. They synchronize through the same Gnosi server, or when the same Vault folder is synchronized between devices. Changes refresh periodically and when you return to the app; use Refresh to check immediately. If synchronization fails, saved items and editing drafts are kept so you can retry.

Use **Save current view** to add a table, a saved view, a drawing or another stable Gnosi view. View addresses are stored relative to the Vault so each device can use its own local address. Dashboards, records and templates use the same page bookmark type; the Dashboards catalog remains available.

## Expected result {#expected-result}

Your note contains readable text, a link and an accessible attachment.

## If something goes wrong {#troubleshooting}

If a save conflict appears, preserve your unsaved text and compare it with the newer version before retrying. If an attachment is missing, check the original file and active Vault; a thumbnail is not a backup of the original.

## Related guides {#related-guides}

- [Capture sources, read and cite](reading-references.md)
- [Organize records and plan work](databases-planning.md)

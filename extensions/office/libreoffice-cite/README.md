# Gnosi Cite — LibreOffice Writer extension

A Mendeley Cite-style extension for inserting references from the Gnosi Vault
(`Resources` table) into Writer documents as formatted citations with an
automatically generated bibliography.

It is the counterpart of the
[Word add-in](../../frontend/public/word-addin/) and uses the same backend and
Pandoc pipeline.

## Features

- **Dynamic search** by `Citation Key`, `Title`, or `Author`.
- **Tracked insertion** through Writer reference marks named
  `gnosicite::<key>::<uuid>`, allowing later reformatting.
- **Automatic bibliography** rendered through Pandoc citeproc.
- **CSL styles**: APA 7, Chicago author-date, MLA, and IEEE.

## Architecture

```
[LibreOffice Writer]
   └── "Gnosi Cite" menu
        ├── Insert citation…        → gnosicite:insertCitation
        ├── Insert bibliography     → gnosicite:insertBibliography
        ├── Refresh all (APA)       → gnosicite:refreshAll
        └── Settings…               → gnosicite:settings
              ↓ protocol handler (gnosi_cite.py, Python/UNO)
              ↓ urllib (standard library)
[Gnosi backend]
   ├── GET  /api/health
   ├── GET  /api/vault/search-citations?q=…
   ├── GET  /api/vault/format-citation?key=…&style=apa&locale=en-US
   ├── POST /api/vault/format-citations    { keys[], style, locale }
   └── POST /api/vault/format-bibliography { keys[], style, locale }
              ↓ subprocess
[Pandoc + citeproc + CSL styles + locales]
```

These are the same endpoints used by the Word add-in; the backend requires no
integration-specific changes.

## APA compliance

APA and other author-date styles have context-sensitive rules such as
`2020a`/`2020b` suffixes, initials for authors with the same surname, and
`et al.` after the first appearance. Pandoc citeproc must receive all document
citations together.

Each insertion therefore reformats **all citations** automatically through one
plural `format-citations` call with all keys in order, including duplicates.
Every reference mark receives its final text.

After changing the style, use **Gnosi Cite > Refresh all (APA)** to propagate
the change. The dialog's selector does not detect later changes automatically.
Generate the bibliography with **Insert bibliography**.

## Requirements

- LibreOffice 5.0 or later with Python scripting. Official macOS, Windows,
  and most Linux builds include it. Some Linux distributions require
  `libreoffice-script-provider-python`.
- A reachable Gnosi backend, defaulting to `http://localhost:5002`, with
  Pandoc installed. Docker deployments already include Pandoc through
  `Dockerfile.backend`.

> LibreOffice's embedded Python does not include `requests`; the extension
> uses only the standard-library `urllib`.

## Build

```bash
cd extensions/office/libreoffice-cite
./build.sh          # generates gnosi-cite.oxt
```

## Installation

### Graphical interface

1. Open **LibreOffice > Tools > Extension Manager > Add**.
2. Select `gnosi-cite.oxt`.
3. Restart LibreOffice.
4. Open a Writer document; the **Gnosi Cite** menu appears.

### Command line

```bash
# macOS
/Applications/LibreOffice.app/Contents/MacOS/unopkg add --force gnosi-cite.oxt

# Linux or Windows, with unopkg on LibreOffice's PATH
unopkg add --force gnosi-cite.oxt
```

Uninstall with `unopkg remove com.gnosi.cite`.

## Usage

1. Open **Gnosi Cite > Settings**, enter the backend URL once, and save.
2. Open **Gnosi Cite > Insert citation**:
   - Search by key, title, or author.
   - Choose APA 7, Chicago, MLA, or IEEE.
   - Double-click an entry or choose **Insert citation**. APA citations in the
     document are reformatted automatically after every insertion.
3. Choose **Insert bibliography** after adding all citations. If the style
   changed, first choose **Gnosi Cite > Refresh all (APA)**.

Configuration is stored at `~/.config/gnosi-cite/config.json`.

## Distribution

The `.oxt` is currently installed from GitHub releases. See
[PUBLISHING.md](PUBLISHING.md) for publishing it to
extensions.libreoffice.org with a free TDF account and moderation.

## Known compatibility

- ✅ LibreOffice Writer 5.0 and later on macOS, Windows, and Linux.
- ✅ `.odt` and `.docx` documents.
- ✅ **Citations inside tables**: since v0.1.2, ordered refresh descends into
  tables, including nested tables, and places citations at the table's
  position in document order for correct APA disambiguation.
- ⚠ **Headers and footers**: their keys are included in the bibliography, but
  their citation text is not changed by **Refresh all**. Repeated page content
  has no unique position in document reading order for disambiguation.
- ❌ Apache OpenOffice is untested. It provides reference marks but registers
  Python components differently.

## Troubleshooting

### The "Gnosi Cite" menu does not appear

- Confirm the active document is a Writer text document.
- Restart LibreOffice completely after installation.
- On Linux, verify Python scripting is present, for example with
  `sudo apt install libreoffice-script-provider-python`.

### "Cannot connect to Gnosi"

- Verify that `/api/health` responds.
- Check the URL under **Gnosi Cite > Settings**.
- Remote connections require `https://` with a valid certificate.

### "Open a Writer document first"

The command ran without an active text document. Open or create an
`.odt`/`.docx` file and try again.

### Citations are not reformatted by "Refresh all"

Only citations inserted by this extension have a `gnosicite::…` reference
mark. Plain-text citations cannot be rerendered.

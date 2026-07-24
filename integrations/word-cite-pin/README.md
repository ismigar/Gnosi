# Gnosi Cite — pinning the Word task pane to documents

This single-file utility makes the **Gnosi Cite** task pane reopen whenever a
document opens, without manually inserting the add-in again.

## Problem

Word on macOS does not retain the ribbon button of a sideloaded add-in. After
Word closes, the button disappears and the add-in must be opened again from
Developer Add-ins. See `word_addin_persistence.md` for the full diagnosis.

Office supports *autoopen*, which reopens a designated pane. Microsoft removed
this behavior for Marketplace add-ins on 2026-03-02 but retained it for
sideloaded add-ins.

The relevant attribute is `visibility` in
`word/webextensions/taskpanes.xml`:

| Value | Behavior |
|-------|----------|
| `0` | Autoopen works only when the add-in is already installed on the device. A macOS sideload never reaches that persistent installed state. |
| `1` | Word distributes the add-in reference with the document and asks for trust once. This works. |

`Office.context.document.settings` can write only `0`. Writing `1` requires
Open XML, which is exactly what this utility does.

## Machine installation: `install.sh`

Quit Word completely, then run:

```bash
./install.sh            # manifest → wef/ and patch Normal.dotm
./install.sh --status   # inspect installed state
./install.sh --undo     # restore pre-Gnosi Normal.dotm and remove the manifest
```

Patching `Normal.dotm`, the global template Word clones for each blank
document, means **every new document is born pinned** and opens the pane
automatically. This inheritance was verified with Word for Mac on 2026-07-21.
Word asks for trust the first time.

The installer stores the original template as `Normal.dotm.pre-gnosi` beside
the active file. `--undo` restores it byte for byte.

## Per-document use: `pin_taskpane.py`

Use the script for documents created before `Normal.dotm` was patched or
received from elsewhere:

```bash
python3 pin_taskpane.py document.docx
python3 pin_taskpane.py ~/Thesis/*.docx
python3 pin_taskpane.py document.docx --dry-run
python3 pin_taskpane.py document.docx --undo
```

It uses only the Python 3 standard library, modifies documents in place, and
creates a `.bak` copy unless `--no-backup` is supplied. It is idempotent:
running it again on an already pinned document changes nothing.

The add-in `<Id>` and `<Version>` are read from
`frontend/public/word-addin/manifest.xml`; they are not duplicated here.

## Covered document states

- If the document previously contained the add-in, its `webextension` parts
  exist with `visibility="0"` and the script updates them.
- If the document never contained the add-in, the script injects
  `taskpanes.xml`, `webextension1.xml`, its `.rels`, the relationship in
  `_rels/.rels`, and both `[Content_Types].xml` overrides.

The second result matches Word's canonical output except for the
`<we:webextension>` element `id`. The script derives it from the add-in GUID
instead of generating it randomly, making the operation idempotent. Nothing
else in the package references that element ID.

## Warnings

- **The version travels inside the document.** After increasing the manifest
  version, run the script again so document references do not lag behind.
- **The document must be saved** because the state lives in the file, not in
  Word preferences.
- This does not restore the global ribbon button; it persists the **task
  pane**.
- **LibreOffice removes the pin when saving.** A verified
  `soffice --convert-to docx` round trip removes the three `webextensions`
  parts. Run the script again after editing a pinned `.docx` in Writer.
  LibreOffice's own `.oxt` extension in `integrations/libreoffice-cite/`
  persists by design; the session issue is specific to Word on macOS.

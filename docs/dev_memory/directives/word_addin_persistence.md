# Directive: Gnosi Cite persistence in Word

**Status:** Diagnosed and implemented on 2026-07-21.

## Platform diagnosis

On macOS, a web add-in sideloaded from Word's `wef/` directory registers its
ribbon command only for the current session. Word writes persistent
`AppCommands` entries for catalog add-ins such as AppSource or centralized
deployment, not developer sideloads.

This is a platform behavior, not a defect in Gnosi's TLS certificate,
`SourceLocation`, Vite LaunchAgent, or `VersionOverrides`.

Windows trusted-folder catalogs persist commands normally.

## Rejected options

- A VBA `.dotm` integration like Zotero would require a second UI, macOS
  AppleScript helper, Windows COM implementation, and would lose Word for the
  web. Keep only as a last-resort alternative.
- AppSource publication requires public hosting and introduces public
  HTTPS-to-localhost browser restrictions. It conflicts with Gnosi's
  local-first task pane.
- Microsoft 365 centralized deployment requires a tenant administrator and
  does not generalize to individual users.

## Implemented solution: Open XML autoopen

Office's `Office.AutoShowTaskpaneWithDocument` setting can reopen a task pane.
Office.js writes `visibility="0"`, which still requires the add-in to be
installed and therefore does not solve macOS sideload persistence.

Open XML can write `visibility="1"`, distributing the add-in reference with
the document. Word then requests trust once and opens the pane after a
complete restart. This was verified for:

- documents that previously contained the add-in;
- documents that never contained it;
- new blank documents inherited from a patched `Normal.dotm`.

Product tools:

- `integrations/word-cite-pin/pin_taskpane.py` patches existing documents.
  It is standard-library-only, idempotent, supports `--dry-run` and `--undo`,
  and creates a backup by default.
- `integrations/word-cite-pin/install.sh` installs the manifest and patches
  `Normal.dotm`, preserving `Normal.dotm.pre-gnosi` for byte-identical undo.
  It also supports `--status`.

The generated package matches Word's Open XML structure. The webextension
element ID is derived from the add-in GUID for idempotency.

## Installation behavior

Patching `Normal.dotm` makes every new blank document inherit the autoopen
parts. Existing documents need the per-document script or one manual
open-and-save cycle.

The manifest version is embedded in each document reference. After increasing
`<Version>`, rerun the script on pinned documents.

If Word later rewrites `Normal.dotm`, `install.sh --status` detects missing
parts and reinstalling restores them.

## LibreOffice interaction

LibreOffice's `.oxt` extension persists independently and does not need this
mechanism. However, Writer removes Word's `word/webextensions/` parts when it
saves a `.docx`. Run `pin_taskpane.py` again after editing a pinned document
in Writer.

## Restrictions and diagnostics

- Increase `<Version>` for every published manifest change; Word caches by
  `<Id>_<Version>`.
- Edit the repository manifest first and copy it to `wef/`. Never let the
  deployed copy become the source of truth.
- The ribbon command belongs on `TabReferences`.
- Two manifests with the same `<Id>` in `wef/` make the add-in invisible.
- Absence of the Gnosi ID under persistent `Wef/AppCommands` confirms the
  expected sideload limitation; manifest tweaking cannot make the ribbon
  command persistent.
- Use `visibility="1"` only through verified Open XML manipulation.

Detailed installation and troubleshooting instructions live in
`monorepo/apps/gnosi/frontend/public/word-addin/README.md` and
`monorepo/apps/gnosi/integrations/word-cite-pin/README.md`.

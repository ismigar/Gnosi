# Gnosi Cite — Office Add-in for Word

A Mendeley Cite-style sidebar for inserting references from the Gnosi Vault
(`Resources` table) into a Word document as formatted citations with an
automatically generated bibliography.

## Features

- **Dynamic search**: filters Resources by `Citation Key`, `Title`, or `Author`.
- **Tracked insertion**: each citation is inserted as a Word Content Control
  tagged `gnosi-cite:<key>`. This allows citations to refresh when the style
  changes.
- **Automatic bibliography**: the "Insert bibliography" button collects all
  citations in the document and renders the bibliography at the end through
  Pandoc citeproc.
- **CSL styles**: APA 7, Chicago author-date, MLA, and IEEE.
- **Locales**: ca-AD, es-ES, en-US, and en-GB.

## Architecture

```
[Word host]
   └── Task pane (sidebar)
        ├── Static HTML/CSS/JS served publicly by Gnosi
        └── Office.js (official Microsoft CDN)
              ↓ fetch
[Gnosi backend]
   ├── GET  /api/vault/search-citations?q=…
   ├── GET  /api/vault/format-citation?key=…&style=apa&locale=en-US
   ├── POST /api/vault/format-citations   { keys[], style, locale }  ← APA batch
   └── POST /api/vault/format-bibliography { keys[], style, locale }
              ↓ subprocess
[Pandoc + citeproc + CSL styles + locales]
```

The backend reuses the same Pandoc pipeline as `/export/{page_id}`: the same
styles and locale handling.

## APA compliance

APA and other author-date styles have context-sensitive rules:

- Same author and year in different sources → `2020a`, `2020b` suffixes.
- Different authors with the same surname → initials for disambiguation
  (`Smith, J. (2020)` versus `Smith, A. (2020)`).
- First appearance of a group with many authors → full names; later
  appearances → `Smith et al.`.

Pandoc citeproc must receive **all citations in the document together** to
make these decisions. The add-in therefore handles this automatically:

- **When inserting a citation**, it reformats every citation in the document
  with full context. A single plural `format-citations` call receives all keys
  in order, including duplicates, and updates every Content Control with the
  final text (`2020a`/`2020b`, initials, and `et al.`).
- **When changing the style** in the selector, previously inserted citations
  are reformatted automatically.

Generate the **bibliography** with the **Insert bibliography** button. Generate
it again if the citation style changes afterward.

## Prerequisite: local HTTPS with mkcert

⚠ **Word requires the task pane to load over HTTPS.** `manifest.xml` points to
`https://localhost:5173`, while Vite serves HTTP by default. Without HTTPS, the
pane is blank.

The certificate must also be **trusted**. Word's WebView rejects an ordinary
self-signed certificate without offering an acceptance prompt. Use
[mkcert](https://github.com/FiloSottile/mkcert), which installs a local CA in
the system keychain.

```bash
brew install mkcert nss   # once
scripts/runtime/setup-https-dev.sh     # CA + certificate in frontend/certs/ (gitignored)

# Restart Vite so it reloads the configuration and switches to HTTPS:
launchctl kickstart -k gui/$UID/com.gnosi.frontend-native   # native (default)
docker compose restart frontend                             # Docker deployment
```

`vite.config.js` detects `frontend/certs/localhost.pem` and enables HTTPS
automatically. Verify it with
`curl -sI https://localhost:5173/word-addin/index.html`; the response must be
`200`. If no certificates exist, Vite continues over HTTP without breaking
other development workflows.

## Local installation (sideloading)

Word 2016 and later can sideload an add-in for development and testing without
publishing it to Microsoft Store.

### macOS — recommended: installer

Quit Word completely (`Cmd+Q`), then run:

```bash
cd ../../../extensions/office/word-cite && ./install.sh
```

The installer copies the manifest into `wef/` and patches `Normal.dotm` so
**new documents open the pane automatically**. See
[Task pane persistence on macOS](#task-pane-persistence-on-macos). Use
`./install.sh --status` to verify the installation and `./install.sh --undo`
to restore it.

### macOS — manual installation

The sideload directory is
`~/Library/Containers/com.microsoft.Word/Data/Documents/wef/`. It must contain
**one manifest file only**; the filename itself does not matter.

```bash
WEF=~/Library/Containers/com.microsoft.Word/Data/Documents/wef
mkdir -p "$WEF"
rm -f "$WEF"/*.xml          # Never keep two copies of the same add-in.
cp manifest.xml "$WEF"/
```

⚠ **Two copies of the same manifest make the add-in invisible.** Word indexes
manifests by `<Id>`. If two manifests have the same `<Id>`, neither is
registered in the ribbon. `office-addin-dev-settings registered` still lists
both and therefore cannot detect this problem. Delete the older copy when
installing a manifest downloaded from a release.

⚠ **Increase `<Version>` when reinstalling.** Word caches a manifest as
`<Id>_<Version>`. If the version is unchanged, Word does not reload it and can
keep using an older payload even when the file on disk is new.

Quit Word completely and reopen it with a document.

#### Opening the add-in manually

Without the installer, repeat these steps in every Word session:

1. Open **Home > Add-ins**, find **Developer Add-ins**, and choose
   **Gnosi Cite**. The task pane opens.
2. For the rest of that Word session, the **Gnosi Citations** button also
   appears in the **Gnosi** group on the **References** tab, beside tools such
   as Mendeley Cite.

⚠ **On macOS, the ribbon button does not survive a Word restart.** This was
verified with Word 16.110.3 on 2026-07-21. Word writes the persistent ribbon
cache (`…/Office/16.0/Wef/AppCommands/`) only for add-ins installed from a
catalog, such as AppSource or centralized deployment. These appear as
`EXCatalog`, like Mendeley Cite or RefWorks.

A manifest sideloaded from `wef/` is read and cached, but its
`VersionOverrides` applies only to the current session. Increasing `<Version>`
no longer fixes this behavior. A catalog publication is required for a
permanent **ribbon button**; the local *autoopen* mechanism is sufficient for
the **task pane**. See the next section.

If the add-in does not appear under Developer Add-ins, see
[The button does not appear in the ribbon](#the-button-does-not-appear-in-the-ribbon).

### Task pane persistence on macOS

Office supports *autoopen*, which reopens a designated task pane when a
marked document opens. Microsoft removed this behavior for Marketplace
add-ins on 2026-03-02 but retained it for sideloaded add-ins.

Office.js writes `visibility="0"`, which only works when the add-in is
installed. That creates a circular dependency on macOS because a sideloaded
add-in is never installed persistently. `visibility="1"` works, but can only
be written through Open XML. The tools in
[`extensions/office/word-cite/`](../../../extensions/office/word-cite/) implement
that approach:

- **`install.sh`** patches `Normal.dotm`, the template Word clones for each new
  blank document. **Every new document then opens the pane automatically.**
  This inheritance was verified in Word for Mac on 2026-07-21. The installer
  keeps the pre-Gnosi copy, and `--undo` restores it byte for byte.
- **`pin_taskpane.py DOC.docx`** patches existing documents individually. It
  is idempotent and supports `--dry-run`, `--undo`, and a default `.bak`
  backup. As a manual alternative, open the add-in once in the document and
  save it.
- On first use, Word asks whether to trust the add-in. Accept the prompt.

Known limitations:

- The manifest `<Version>` is embedded in the document reference. After a
  version increase, run the script again on existing documents.
- **LibreOffice Writer removes the pin when it saves a `.docx` file.** It
  discards the `word/webextensions/` parts; this was verified with a
  `soffice --convert-to docx` round trip. Run the script again afterward.
  LibreOffice itself uses the persistent `.oxt` extension in
  [`extensions/office/libreoffice-cite/`](../../../extensions/office/libreoffice-cite/);
  the session limitation is specific to Word on macOS.

### Windows

1. Create a shared directory, for example `\\localhost\addins`.
2. Copy `manifest.xml` into it.
3. In Word, open **File > Options > Trust Center > Trusted Add-in Catalogs**,
   add `\\localhost\addins`, and enable **Show in Menu**.
4. Restart Word and open **Insert > My Add-ins > SHARED > Gnosi Cite**.

Windows does not need the installer because a trusted folder catalog is a real
catalog and keeps the ribbon button persistent.

### Word for the web

1. Open a document at https://word.office.com.
2. Choose **Insert > Add-ins > Upload My Add-in > Select File**, then select
   `manifest.xml`.

## Gnosi backend requirements

- The `/api/health` endpoint must be reachable.
- `/api/vault/search-citations`, `/api/vault/format-citation`, and
  `/api/vault/format-bibliography` must work.
- Pandoc must be installed and available on the backend `PATH`. For native
  development, run `brew install pandoc`. Docker deployments already include
  it through `Dockerfile.backend`. Without Pandoc, the endpoints return
  `{"detail":"pandoc not available"}` and the add-in inserts the raw key
  `(ardite2025)` instead of `(Ardite, 2025)`.
- CSL styles must be available in `frontend/public/csl/styles/`; the
  `refresh-vendor-files.yml` workflow refreshes them weekly.

## Production

Publishing through a **catalog** is the only way to keep the **Gnosi
Citations** ribbon button permanently visible. Catalog add-ins enter the
persistent `AppCommands` cache; sideloaded add-ins do not. The local installer
already keeps the **task pane** persistent. See
[Task pane persistence on macOS](#task-pane-persistence-on-macos).

1. Generate a new manifest `<Id>` GUID with `uuidgen`.
2. Replace every `https://localhost:5173` occurrence with the production URL,
   for example `https://gnosi.example.com`.
3. Publish through **Microsoft 365 Admin Center > Integrated Apps > Upload
   custom apps** for a Microsoft 365 tenant, or through **AppSource** for
   public distribution.
4. Assign the add-in to the required users or groups.

On Windows, a **shared-folder catalog** under Trust Center also counts as a
catalog, which makes its ribbon button more stable than macOS sideloading.

Verified on 2026-07-21: before hosting the task pane on a public origin,
remember that Chrome 142 and later block requests from a public HTTPS origin
to `localhost` unless the frame sets the `local-network-access`
Permissions-Policy. Office iframes do not set it
(OfficeDev/office-js#6281). The current localhost-to-localhost setup is not
affected; a public task pane that calls a local backend would be.

## Known compatibility

- ✅ Word 2019 and later on Windows.
- ✅ Word 2019 and later on macOS.
- ✅ Word for the web at https://word.office.com.
- ⚠ Word 2016: Content Controls may fail and fall back to plain text without
  refresh tracking.
- ❌ Word for Android: task pane Office Add-ins are not supported.

## Authentication token

When `GNOSI_REQUIRE_AUTH` is enabled, the backend rejects requests without a
credential. The add-in runs in an Office WebView with its own origin, so it
does not receive Gnosi's session cookie. It must use a Personal Access Token.

1. In Gnosi, open **Settings > API Tokens** and create a token. It is shown
   only once.
2. In the add-in pane, open **Token settings**, paste the token, and choose
   **Save**.

The token is stored in the WebView's `localStorage` under
`gnosi.wordAddin.apiToken`, only on that device. The pane never displays the
complete token again.

## Troubleshooting

### The button does not appear in the ribbon

The button is under **References > Gnosi > Gnosi Citations**, not **Home**.
With macOS sideloading it appears only after opening the add-in once in the
current session through **Home > Add-ins > Developer Add-ins > Gnosi Cite**.
If it still does not appear, check these items in order:

```bash
WEF=~/Library/Containers/com.microsoft.Word/Data/Documents/wef
ls "$WEF"                                                    # 1) Exactly ONE .xml file.
npx office-addin-dev-settings registered                     # 2) Exactly ONE entry.
npx office-addin-manifest validate "$WEF"/*.xml              # 3) "The manifest is valid"
curl -sI https://localhost:5173/word-addin/index.html         # 4) 200 over HTTPS
```

If more than one manifest has the same `<Id>`, or Word has already cached the
same `<Version>`, it does not reload the file. Repair this deterministically:

```bash
WEF=~/Library/Containers/com.microsoft.Word/Data/Documents/wef
rm -f "$WEF"/*.xml
# Increase <Version>, for example 1.3.0.0 → 1.4.0.0, then copy the manifest.
cp manifest.xml "$WEF"/
```

Quit Word completely (`Cmd+Q`) before reopening it. The cached manifest appears
under
`~/Library/Containers/com.microsoft.Word/Data/Library/Application Support/Microsoft/Office/16.0/Wef/…/Manifests/`
as `<Id>_<Version>` with the size of the new file. Its presence proves Word
processed the manifest. If the button still is not permanent, that is the
sideload limitation described above, not a manifest error.

Manually clearing WebKit or Wef caches is unnecessary and does not fix this
behavior.

### The pane does not open automatically in a new document

The behavior is inherited from `Normal.dotm`. Run `./install.sh --status`; it
must report that the template is pinned. Word can rewrite `Normal.dotm` when
saving styles or AutoText, so run `./install.sh` again if needed.

Existing documents are pinned individually with
`pin_taskpane.py DOC.docx`. If LibreOffice Writer saved the document, the pin
was removed and the script must be run again.

### The ribbon icon is outdated

Word caches icons by URL and does not fetch them again when the file changes.
Icon URLs include a cache-busting query such as `icon-32.png?v=3`. Increase the
suffix, for example to `?v=4`, together with the manifest `<Version>`.

### "Token required" / "Invalid token"

The pane header distinguishes between a missing saved token and a token the
backend rejects because it was revoked or belongs to another installation. In
both cases, token settings open automatically. A valid token starts with
`gnosi_pat_`.

### "Cannot connect to Gnosi"

The add-in fetches from `window.location.origin`, the same origin that serves
the sidebar. Verify:

- The Gnosi backend responds at `/api/health`.
- The add-in is served over `https://`; Word rejects `http://` for hosts other
  than localhost.
- The manifest contains the correct domain in `<AppDomains>`.

### "Word.run failed"

The Word host may not support Content Controls, as in partial Word for the web
support or Word 2016. The `setSelectedDataAsync` fallback inserts the citation
as plain text without refresh tracking.

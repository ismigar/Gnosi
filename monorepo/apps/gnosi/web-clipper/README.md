# Gnosi Web Clipper

A Manifest V3 browser extension for saving a web page or selected text to a
Gnosi vault. It supports Chromium browsers (Chrome, Edge, Brave, Vivaldi,
Opera, and Arc), Firefox, and Safari.

## How it works

The extension sends `POST {backend}/api/public/clip` with
`Authorization: Bearer <PAT>`. Gnosi, not the extension, determines the clip
destination through **Settings > Plugins > Web Clipper**.

- **No destination table** (default): the backend creates a note in the
  vault's `Clips/` folder with the source link, captured content, and tags.
- **Destination table configured**, such as `Resources`: the backend creates
  a table record with the URL, tags, and note in the configured columns.
  Fields marked for prompting appear in the popup before saving. The popup
  reads them from `GET /api/public/clip/config`, so they always match the
  current table schema.

When the plugin is disabled in Gnosi, the backend returns `403` and the popup
reports that clipping is disabled.

## Development installation

First create a token in **Gnosi > Settings > API and tokens > Create token**.
Copy it when shown; it is displayed only once. Then load the extension:

### Chromium: Chrome, Edge, Brave, Vivaldi, Opera, and Arc

Open `chrome://extensions` or the browser equivalent, enable **Developer
mode**, choose **Load unpacked**, and select this `web-clipper/` directory.

### Firefox

Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**,
and select this directory's `manifest.json`. The temporary installation lasts
until Firefox closes. For a permanent installation, sign the package at
[addons.mozilla.org](https://addons.mozilla.org/developers/) by uploading the
`gnosi-web-clipper-store.zip` produced by `./build.sh`.

Firefox host permissions are optional. When saving settings, Firefox asks for
access to the configured Gnosi domain. If access is denied, the clipper cannot
send requests to that domain.

### Safari on macOS

Safari requires converting the web extension into an app with Xcode. After a
new Xcode installation, run these otherwise non-obvious initialization steps;
without them the converter can fail with "A required plugin failed to load."

```bash
sudo xcodebuild -license accept
xcodebuild -runFirstLaunch
```

Then convert the extension:

```bash
xcrun safari-web-extension-converter monorepo/apps/gnosi/web-clipper
```

Open the generated Xcode project, build it, and run it once. Then open
**Safari > Settings > Extensions** and enable the clipper. If it is not signed
with an Apple Developer account, enable unsigned extensions from Safari's
Develop menu.

### After installation

1. Open the extension popup, choose **Settings**, enter the Gnosi URL such as
   `https://localhost:5173`, paste the token, and save.
2. On any web page, select **Save this page** or **Save selection only**.

## Notes

- The endpoint belongs to the PAT-authenticated public API under
  `/api/public/*`, separate from cookie sessions. Tokens can be revoked from
  the same Gnosi settings tab.
- The implementation uses `browser.*` when available in Firefox or Safari and
  falls back to `chrome.*` in Chromium. Both variants return promises under
  Manifest V3.
- Icons in `icons/` are generated from the canonical
  `frontend/public/favicon.svg`; do not edit them manually. Regenerate them
  after a logo change with:

  ```bash
  for s in 16 32 48 128 512; do
      /Applications/Inkscape.app/Contents/MacOS/inkscape --export-type=png \
          --export-filename="icons/icon-$s.png" -w $s -h $s \
          ../frontend/public/favicon.svg
  done
  ```

- Without a destination table, saved notes appear in `Clips/` and can be
  reorganized like any other vault note.
- With a destination table, the new record follows the same path as a record
  created in the app, including automations, formulas, and column defaults.

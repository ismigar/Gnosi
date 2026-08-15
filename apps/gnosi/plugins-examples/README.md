# Gnosi example plugins (v2)

Reference third-party plugins for Gnosi's plugin system. See
`docs/dev_memory/directives/plugin_system.md`.

## Installation

Copy the plugin directory into `<vault>/.gnosi/plugins/`:

```sh
cp -R hello-command "<vault>/.gnosi/plugins/"
```

Then open **Settings > Plugins > Third-party plugins**, enable it, and grant
the requested permissions. A plugin remains inert until its permissions are
approved.

## Examples

| Plugin | Type | Behavior |
|--------|------|----------|
| `hello-command` | UI (sandboxed iframe) | Adds "Hello from the example plugin" to the command palette (`Cmd/Ctrl+Shift+P`). Permissions: `ui:command`, `vault:read`. |
| `clone-logger` | Data (Node sandbox) | Handles `clone:finished` and `page:updated` events and logs them. Permission: `vault:read`. |

## Plugin anatomy

- `manifest.json` is required and declares `id`, `version`, and
  `permissions[]`. UI plugins use `main` for their JavaScript entry point.
  Data plugins use `backend` for their `.mjs` entry point and `events[]` for
  subscribed events.
- **UI plugins** run in an isolated iframe and access only the global `gnosi`
  object: `registerCommand`, `registerView`, `registerSidebarPanel`,
  `vault.*`, `fetch`, and `log`.
- **Data plugins** export `onEvent(event, api)`. They run in a constrained Node
  subprocess and access the vault through `api.vault.*`, gated by granted
  permissions.

Manifest permissions are the maximum permissions a user can grant. Without a
grant, the corresponding API does not exist for the plugin.

`apiVersion` is optional and defaults to `1`. It identifies the major API
version expected by the plugin. Gnosi rejects a plugin that requests a newer
version than `plugin_system.PLUGIN_API_VERSION`.

## Signing and distribution

Plugins installed from a remote `.zip` or remote index can be signed with
Ed25519. Gnosi verifies the signature against its trust store before
installation:

- signed and verified → installed;
- signed but not verified → rejected;
- unsigned → installed and marked unverified.

The authoring tool `sign_plugin.py` depends only on `cryptography`:

```sh
# Generate a key pair and keep the private key secure.
python sign_plugin.py keygen

# Sign a plugin directory, write its ZIP, and print the catalog entry.
python sign_plugin.py sign my-plugin <PRIVATE_KEY_B64> \
    --url https://your-host/my-plugin.zip --out my-plugin.zip
```

End users add the author's public key through **Settings > Plugins > Remote
source and trust**, or `POST /api/vault/plugins/trust`.

### Official Gnosi key

The `gnosi-official` public key is bundled in
`plugin_signing.BUNDLED_TRUSTED_KEYS`; users do not add it manually. Its
private key is outside the repository at
`~/.gnosi-local/plugin_signing_key.json` with mode `600`.

To rotate the key, run `sign_plugin.py keygen`, replace the public key in the
code, and save the new private key in the same local location.

### Signed remote index in the release pipeline

The release job in `.github/workflows/build-release.yml` builds and signs the
official plugin index through `build_index.py`:

- The raw base64 Ed25519 private key comes from
  `GNOSI_PLUGIN_SIGNING_KEY` and never touches the repository. Without this
  secret, the index is unsigned and the app marks its plugins unverified.
- Each official plugin ZIP and `plugins-index.json` are published as release
  assets under `ismigar/Gnosi`. Entries include `url`, `sha256`, and
  `signature`.
- Entries use `releases/latest/download/…`. They become active when the draft
  release produced by the workflow is published.

Configure the secret once from the machine that holds the private key:

```sh
python3 -c "import json,pathlib;print(json.loads((pathlib.Path.home()/'.gnosi-local'/'plugin_signing_key.json').read_text())['private'])" \
  | gh secret set GNOSI_PLUGIN_SIGNING_KEY --repo ismigar/Projectes
```

The default gallery URL is:

`https://github.com/ismigar/Gnosi/releases/latest/download/plugins-index.json`

Gnosi verifies its signature against `gnosi-official` before installation.

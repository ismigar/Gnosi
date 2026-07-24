# Directive: Gnosi plugin system

**Status:** Third-party plugin v2 implemented and verified on 2026-07-02.

Gnosi supports its own UI and data plugins. It does not promise binary or API
compatibility with Obsidian plugins, whose editor and metadata abstractions do
not map to Gnosi. A future shim may support an explicitly enumerated subset.

## Implemented architecture

### Backend

- `plugin_system.py`: discovery, manifest validation, and permission model.
- `plugin_events.py`: fire-and-forget event bus.
- `plugin_sandbox.py` and `plugin_runtime/runner.mjs`: Node permission sandbox
  and JSON-RPC bridge.
- `plugin_dispatcher.py`: connects events, sandbox, and permission-gated host
  methods; wired from server lifespan.
- Vault routes expose installed state, catalog, permissions, safe assets,
  settings, remote registry, trust keys, installation, and removal.
- Per-vault state lives in `.gnosi/plugins.json`; plugin directories live
  under `.gnosi/plugins/<id>/`.

### Frontend

- `frontend/src/plugins/host.js`: opaque-origin
  `sandbox="allow-scripts"` iframe, CSP, `postMessage` bridge, and contribution
  store.
- `usePluginHost.js`: React lifecycle and reload integration.
- Command Palette merges plugin commands in a Plugins section.
- Plugin Settings manages built-ins, third-party activation, grants, gallery,
  remote registry, trust keys, installation, and removal.

### Examples

`plugins-examples/` contains UI command, data event logger, and vault
statistics examples. Copy a local plugin into
`<vault>/.gnosi/plugins/`.

## Manifest and permissions

`manifest.json` declares identity, version, optional UI `main`, optional data
`backend`, events, `apiVersion`, and maximum permissions:

- `vault:read`, `vault:write`, `vault:delete`;
- `network`;
- `ui:view`, `ui:command`, `ui:sidebar`;
- `settings`.

A capability exists only when both declared and granted. New installations
start disabled with no grants.

Increment `PLUGIN_API_VERSION` only for incompatible major API changes.
Reject manifests that require a newer major version.

## UI sandbox

UI code runs in an isolated iframe and communicates only through the host
bridge. It cannot directly access Gnosi's DOM. `registerCommand`,
`registerView`, sidebar, settings, Vault methods, and network access are
permission-gated.

## Data sandbox

Data plugins run in a constrained Node subprocess, never through `exec` in the
FastAPI process. The Node permission model blocks child processes, workers,
addons, and direct filesystem access.

ESM registration hooks reject network modules including `node:net`,
`http`, `https`, `tls`, `dgram`, and `http2`; browser-like network globals
are neutralized. Plugins with network permission use the filtered host API.

All Vault access goes through host methods so normal containment, online-file
materialization, indexing, permissions, and sidecar behavior remain intact.

## Host API

Implemented methods include:

- structured `readPage` and merge-based `writePage`;
- `createPage`, `listTables`, and bounded `queryDB`;
- permission-gated `network.fetch`;
- per-plugin `settings.get` and `settings.set`.

`writePage` must parse existing frontmatter, merge content and metadata, and
save through normal Vault APIs. Never overwrite a complete Markdown file with
raw plugin text.

Events include page creation, update, deletion, import/clone completion, and
other explicitly wired host events. Plugin events are a consumer beside
automations and action rules; do not collapse their separate responsibilities.

## Installation and catalog

- ZIP installation validates the manifest before writing and prevents
  zip-slip and zip-bomb extraction.
- Catalog sources include bundled examples and a configurable remote index.
- Remote packages require matching SHA-256 when supplied.
- Removal deletes the plugin directory and its saved state.

Official release automation builds plugin ZIPs and
`plugins-index.json` in `build-release.yml`. Catalog entries point to
`releases/latest/download`, becoming active when the draft release is
published.

## Signing and trust

Remote ZIP signatures are detached Ed25519 signatures over exact bytes.

- Trusted valid signature → install and record `signedBy`.
- Present but invalid or untrusted signature → reject.
- No signature → install as unverified.

The trust store is `.gnosi/plugins_trust.json`; the bundled
`gnosi-official` public key verifies official packages. Its private key stays
outside the repository under `.gnosi-local` with mode 600 and enters release
automation only through `GNOSI_PLUGIN_SIGNING_KEY`.

Author tooling can generate key pairs and signed catalog entries.

## Restrictions

- Never claim general Obsidian plugin compatibility.
- Plugins may access only declared and granted capabilities.
- Do not expose raw filesystem paths, environment variables, `fs`, or network
  modules to data plugins.
- Multi-user installations must restrict installation and execution through
  administrative grants and Vault access.
- Plugin directories synchronized through OneDrive can arrive online-only;
  use normal file-provider materialization rather than direct reads.
- Native backend reload handles Python source changes, but dependency and
  runtime-process changes still require a LaunchAgent restart.
- Internal Node primitives such as deprecated `process.binding` remain outside
  the formal sandbox guarantee and should be monitored.

## Verification baseline

Tests cover manifest validation, grants, traversal rejection, event dispatch,
network blocking, structured writes, query limits, ZIP safety, checksums,
API versions, settings, signatures, trust, remote indexes, and author tools.

Live QA covered data and UI plugins, command invocation, gallery install,
settings round trips, trust management, and the full Plugin Settings UI.
Frontend build and lint must remain clean.

See `plugins-examples/README.md` for author and distribution instructions.

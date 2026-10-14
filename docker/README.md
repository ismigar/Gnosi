# Compiled web frontend and offline notes

The base `docker-compose.yml` keeps the Vite development frontend. Add
`compose.production.yml` to build and serve the compiled main application and
the `/offline.html` companion through nginx on the same frontend port. The
override changes only the frontend build target; existing authentication,
backend, translation server, ports and data volumes keep their base configuration.

## Build and start

Use a checkout of the intended release, initialize its pinned recursive reader
submodules, and keep the existing Compose project name and storage overrides:

```sh
git submodule update --init --recursive
docker compose -f docker-compose.yml -f compose.production.yml build frontend
docker compose -f docker-compose.yml -f compose.production.yml up -d
```

Set `GNOSI_JWT_SECRET` as described in the root README before invoking Compose.
For an existing host Vault deployment, include `-f compose.vaults.yml` with both
commands and retain its existing `VAULT_HOST_PATH` and `VAULTS_ROOT_HOST_PATH`.
Do not change the Compose project name during an upgrade: it selects the data
volumes. These instructions do not migrate or remove data.

The production builder uses the existing pinned Node/pnpm versions, the frozen
workspace lockfile and the reader's committed npm lockfiles. It removes copied
reader output and rebuilds from the initialized submodule sources using the
existing `build-zotero-reader.sh`. A clean checkout needs no ignored host reader
artifacts or host dependencies. Git metadata and `.env` files remain excluded
from the Docker build context. Reader locale downloads use its pinned Zotero
locale commit. Registry/locale network access is needed during image builds.
The normal Vite reader asset validator and bundle-size budget both run. Run the
repository's full pre-PR checks before distributing an image; an image build is
not a replacement for those checks.

The nginx runtime is versioned separately from the build stage and contains only
the compiled output and server configuration. It serves the main SPA, public
share routes and the offline shell, and proxies `/api` including WebSockets and
streaming requests to the internal `backend:5002` service. Browser API clients
use `location.origin`; the image fixes `VITE_BASE_PATH=/` and an empty
`VITE_API_URL`, so a container DNS name is never a browser API address. API
responses are `no-store`, the worker/HTML/manifest revalidate, and compiled Vite
assets are immutable. Missing compiled assets return 404 instead of SPA HTML.

## Mobile setup

The default loopback binding remains unchanged. For a phone or tablet, serve this
frontend at an **HTTPS origin** through the deployment's TLS reverse proxy, and
forward `/api` to this frontend on that same origin. The outer proxy must support
WebSocket upgrades and replace `X-Forwarded-Proto` with its observed protocol.
Do not cache authenticated API responses. Plain HTTP on a remote LAN hostname or
IP cannot install the offline service worker; localhost is the browser exception.
Subpath/CDN asset bases are not supported by the offline companion.

Sign in through the main app, select a workspace and Vault, then open **Settings
→ General → Offline notes**. Create a collection with a separate passphrase,
select the Markdown notes to retain, and wait for offline availability. Use the
browser's install/Add to Home Screen action. Open the companion, save a small
local edit, switch the device offline and reload it once before relying on it.
Browser installation is the supported mobile distribution, not a native app-store
release.

Notes are encrypted in browser storage; the passphrase and decryption key are
kept only in memory. Explicit **Save locally** retains offline edits, and explicit
sync uses the account/workspace/Vault and ETags selected when the collection was
created. Concurrent server changes require reviewing both versions. Locking
removes decrypted application state. The worker caches only the compiled public
shell: no tokens, note APIs, publication responses or private pages are cached.
The Gnosi server still reads and stores ordinary note content; this is local
browser encryption, not end-to-end encrypted server storage. Clearing browser
data removes local edits, and forgotten passphrases cannot be recovered. See the
[offline companion contract](../frontend/src/features/offline/README.md) for
storage limits, locking and verification details.

## Verify a deployed build

Check `/api/health`, the main app, `/offline.html` and an existing public share
link through the frontend origin. Inspect response headers for the worker,
manifest, compiled asset and authenticated API paths. With a disposable account
and note, verify offline reload and a saved edit, then reconnect after changing
the server note and review the conflict. The repository's disposable compiled
offline Playwright fixture covers this browser behavior; a deployment still
needs a Docker image build and nginx/API smoke check on a Docker-capable host.

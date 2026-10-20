# Offline notes companion

The web/Docker frontend publishes a separate `/offline.html` entry, discoverable
from Settings → General. It uses the same server origin as the main web app.
Users sign in and choose their account/workspace/Vault in Gnosi, then create an
offline collection with a separate passphrase and explicitly select Markdown
notes. A successful production service-worker install enables offline startup;
HTTPS or localhost is required. Browser installation/Add to Home Screen is the
supported mobile distribution. This is not a native app-store release.

The [optional production Docker frontend](../../../../docker/README.md) builds
and serves this entry with the full main app and reader. The default Docker/Vite
development server does not install a production offline shell.

## Storage and locking

One collection per browser profile contains the pinned origin/account/workspace/
Vault and selected notes (title, base content/ETag, saved local content, and any
conflict snapshot). IndexedDB stores only an AES-256-GCM authenticated ciphertext,
a random 16-byte salt, random 12-byte IV, schema version and revision. PBKDF2 with
SHA-256 and 600,000 iterations derives a nonextractable in-memory key from the
passphrase. No passphrase, key or authentication token is persisted. Each save
uses a fresh IV and an atomic revision check to avoid another tab's overwrite.

Local editing requires an explicit **Save locally**. Locks remove the key,
decrypted collection, drafts and server choice list from application state;
pending asynchronous completions cannot restore them. Explicit locking prompts
before discarding unsaved drafts. Closing a dirty page uses the browser's unsaved
changes prompt. Account/workspace/Vault storage changes and page hide lock the
view; returning to a different scope cannot unlock an old collection. A saved
copy can be unlocked offline without auth bootstrap or plugins. This does not
provide memory zeroization or protection against malicious same-origin script.
Clearing browser data deletes copies and unsynced edits. Forgotten passphrases
cannot be recovered. A confirmation allows removal of the encrypted collection.

Only selected text notes are cached: no attachments, embedded-note downloads,
databases or drawings. Limits are 100 notes, one million characters per note and
12 million serialized characters per encrypted collection. Reading view never
loads remote Markdown media or follows note links.

## Synchronization

Every explicit network operation pins all request-context headers, uses
`credentials: same-origin`, `cache: no-store`, rejects redirects, verifies the
signed-in user and workspace membership, and verifies that the Vault is present.
`X-Gnosi-Expected-User-ID` is an expectation-only backend guard against cookie
identity changes between requests. A browser scope change aborts active requests.
This requires the matching backend guard from the same release.

The companion reads the current page through the normal note API. Unchanged
local copies can accept the server copy. A locally changed copy is only patched
when its base ETag still matches. If both changed, the encrypted collection keeps
a conflict snapshot and the UI shows local, server and original versions. Users
explicitly select server/local content or write a merge. Resolutions re-read the
server and require the previewed ETag; a subsequent conflict reopens review.
Every PATCH includes `expected_etag` and `force: false`, preserving the existing
server history and metadata path. Proposed merged text is saved encrypted locally
before networking, so a connection failure does not discard it. Deleted or
unsupported server pages never trigger implicit recreation or force overwrite.

The server still stores and processes ordinary readable notes. Local browser
encryption is not end-to-end encrypted server storage, hosted sync service or a
backup. No background synchronization is scheduled.

## Static cache and verification

The build's `offlineShellPlugin` walks the compiled offline entry's manifest graph
(including lazy locales), adds only reviewed public icons/manifest/offline HTML,
and writes an exact allowlist into `gnosi-offline-worker.js`. The worker fetches
these public files with omitted credentials, checks successful responses and
expected script/style/HTML MIME types, and aborts partial installation on failure.
It only intercepts allowlisted GET URLs without queries; APIs, main-app routes,
private responses and arbitrary assets are never cached. The standalone worker
build currently requires the default origin-root Vite asset base.

Focused tests live in `shared/offline` and `shared/api/offline-sync.test.ts`.
The disposable production browser fixture uses the real Vite configuration and
worker plugin with only the offline entry and public files. The isolated one-entry fixture uses automatic icon splitting
instead of the main app’s multi-entry shell-icon group. It omits the main
app's reader-asset validator only for this isolated fixture; the full release
build still requires that validator and the full repository gates.

From the repository root:

```sh
node tests/e2e/support/offline/build.mjs
cd tests/e2e
pnpm exec playwright test --config support/offline/playwright.config.ts
```

The static fixture server has no backend proxy and the browser intercepts only
synthetic API fixtures. The test verifies encrypted IndexedDB, opt-in downloads,
actual browser offline reload and fresh-tab startup, retained local edits,
conditional conflict resolution, account changes, and static-only CacheStorage.

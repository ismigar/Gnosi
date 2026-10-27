# Gnosi Websites

Optional per-vault `web-publishing` capability. Open **Settings → Plugins → Websites**, enable it, then use **Websites** in the application sidebar. Every site has its own sources, layouts, theme, forms, private service, destinations and release history. Existing page sharing and the staging publisher remain compatible.

## Runtime

The editor uses Gnosi’s regular authenticated API at `/api/vault/sites` (also available through the canonical vault API). The static renderer uses separately locked Astro/Pagefind dependencies. Prepare development dependencies with:

```sh
npm ci --prefix extensions/web-publishing/renderer --no-audit --no-fund
```

The pinned Node executable is included by that package and is used for construction. Astro and Vite caches belong to each private temporary build directory; the installed dependencies and signed application remain immutable. Desktop packaging prepares and verifies the host architecture automatically, then includes the renderer/service outside the application archive. PHP with PDO SQLite, DOM and OpenSSL is required for the private service and local PHP preview. Destination probes report missing runtime capabilities.

## Editorial and private state

Nonsecret configuration is versioned under `<vault>/.gnosi/sites`. New sources are disabled and expose no fields/body/attachments until selected. Table/view/page identifiers are stable; view filters and ordering are evaluated before a snapshot is constructed. A selected missing source or record fails closed. Draft/private state is checked for every source kind. The source union owns each public page once, with independent ordering for each view.

Pages use configurable blocks; global theme tokens, local fonts, page/block adjustments and advanced CSS compile in ordered cascade layers. Generated files are never the editing source. Themes and source changes are reviewed before activation. Search, feeds and sitemap are regenerated with the artifact.

Device-private publication receipts, asset snapshots and operational SQLite live under Gnosi’s local data directory, scoped by workspace/vault/site. SMTP credentials use Gnosi’s credential store. Contact recipients, message contents, subscriber lists and delivery records never enter a public snapshot or the synchronized editorial files.

## Preview and publication

Review an immutable snapshot, inspect the change list and desktop/mobile preview, then publish the reviewed version. Source/configuration changes invalidate the review. Jobs persist phases, actor identity and release receipts; startup recovery checks current membership and plugin enablement before resuming. Local servers have explicit start/status/stop controls verified against the owned process identity.

SSH destinations require an owned isolated namespace and an explicit public document root/private service location. Uploads are integrity checked before an atomic pointer change; uncertain acknowledgements reconcile against the exact owned pointer and manifest. Rollback preserves message, consent and campaign state. Scheduled local publication requires the host to be running; a stopped host recovers pending work when Gnosi restarts.

## Temenos compatibility

Import the administrator-configured existing pilot to freeze its public baseline and assets. Existing URLs and translations survive the import; internal resource exclusions remain. Newly selected Gnosi sources can override matching public identities. The native Pangea adapter reuses the maintained SSH/Suweb bridge and its registered vault list. It publishes only beneath `/_gnosi-proves/webs/<site-id>/current`, inheriting the protected test namespace. Private service data lives outside the document root. Drupal and the earlier `/_gnosi-proves/current` pilot are separate.

## Forms, subscribers and newsletters

The form editor configures localized fields, validation, confirmation, privacy text, optional newsletter signup and private delivery settings. A receipt is stored before notification. Review submissions under Messages; failed mail remains visible and retryable without losing the receipt. Public forms support JavaScript and no-JavaScript submissions.

The private service manages double opt-in, list/global restrictions, suppression-preserving imports, immutable campaign previews, queued schedules and uncertain delivery reconciliation. The daemon runs independently of Gnosi with a per-site lock and heartbeat. Full private protocol and worker setup are documented in [server/README.md](server/README.md).

In **Newsletters**, add already published contents to an automatically saved draft. Choose a digest or featured-reading template, add an introduction and reorder up to 20 unique pages. Only the active release at the selected destination and language is available. Withdrawn or other-language selections are flagged; a changed publication requires refresh and review. Generated links preserve the published deployment prefix. Review HTML, plain text and recipients before explicitly queuing a test; manual HTML/text remains available. Private per-destination drafts use revision checks and never enter publication bundles or website rollback.

In **Newsletters → Delivery queue**, captured rows offer **Read email**. Administrators can read the subject, sender, recipient, date and plain text, or an isolated HTML preview without navigation, scripts, forms or remote images. Reading never follows lifecycle links. Verified confirmation, preferences and list/global unsubscribe links have explicit **Test link in Gnosi** forms; they use the same token operation as the public POST handler, restricted to the captured synthetic recipient. Used, expired and suppressed links are unavailable. **Open on pilot** is optional and retains the pilot’s normal HTTP authentication. Captures never become public files or synchronized editorial data.

The current pilot remains **capture-only** and accepts only synthetic `.invalid` addresses. The Gnosi API keeps production publication and real delivery disabled pending pilot acceptance. Do not migrate real subscribers or replace the production contact form during this validation.

## Verification

```sh
.venv/bin/python -m pytest backend/tests/test_sites.py backend/tests/test_sites_rendering.py backend/tests/test_sites_captured.py
php extensions/web-publishing/server/test.php
python3 extensions/web-publishing/server/test_http.py
```

Use the repository’s focused frontend checks, API generator and full pre-PR gate as well. All test data is disposable; no verification command sends real email or changes Drupal.

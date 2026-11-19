# Gnosi Websites

Optional per-vault `web-publishing` capability. Open **Settings → Plugins → Websites**, enable it, then use **Websites** in the application sidebar. Every site has its own sources, layouts, theme, forms, private service, destinations and release history. Existing page sharing and the staging publisher remain compatible.

## Create or import a website

Choose **Create a blank website** or **Import a website by URL**. URL import reads public HTML, reviews up to the configured page limit (20 by default, at most 100), then lets the administrator select pages before creating them. A 60-second/64 MB download budget and 4 MB image limit apply. Paths, languages, readable content, supported images and navigation become editable configuration. Unsupported or partial results are disclosed. Scripts, server applications, CMS databases and original form handlers are not migrated. Review and configure contact forms separately. Creation and import do not publish anything.

The review is private to the approving account and vault, expires after 30 minutes and binds the exact downloaded content. Creation consumes it idempotently without refetching. Local assets are selected only on explicit creation. Existing pilot sites retain their compatibility adapter; new users see a generic creation flow.

## Runtime

The editor uses Gnosi’s regular authenticated API at `/api/vault/sites` (also available through the canonical vault API). The static renderer uses separately locked Astro/Pagefind dependencies. Prepare development dependencies with:

```sh
npm ci --prefix extensions/web-publishing/renderer --no-audit --no-fund
```

Local previews and separately scoped publication builds reuse authenticated generated pages whose content and dependencies have not changed. An article body edit rebuilds its route and dependent collections; Pagefind indexes the complete restored site. An unchanged preview skips Astro and Pagefind. Feeds still use the current preview URL. Cache faults trigger a full build, source discovery remains current, attachments keep their independent checks, and confirmation/publication never trust preview cache state. Translation publication/withdrawal invalidates its language family, relevant collections and consumed links; unrelated article order metadata does not invalidate its HTML. Legacy redirect aliases and rewrite rules are regenerated independently, so adding or retiring an alias does not invalidate unrelated HTML.

For imported Temenos websites, all English articles receive a descriptive
`/en/title-slug` URL. Existing `/en/title-slug` URLs remain stable after title
edits. Former English article routes and their aliases are omitted from the
generated website. Withdrawal retires the canonical article route.
English language metadata remains `en-gb`.
The table's `URL` field retains each canonical address, including withdrawn
articles. Declared table URLs are reserved while generating other record paths,
so a new duplicate title cannot take over an existing address. Authored internal links are projected onto current URLs
in article bodies, navigation, page blocks and actions; source notes stay intact.

The pinned Node executable is included by that package and is used for construction. Astro and Vite caches belong to each private temporary build directory; the installed dependencies and signed application remain immutable. Desktop packaging prepares and verifies the host architecture automatically, then includes the renderer/service outside the application archive. PHP with PDO SQLite, DOM and OpenSSL is required for the private service and local PHP preview. Destination probes report missing runtime capabilities.

## Editorial and private state

Nonsecret configuration is versioned under `<vault>/.gnosi/sites`. New sources are disabled and expose no fields/body/attachments until selected. Table/view/page identifiers are stable; view filters and ordering are evaluated before a snapshot is constructed. A selected missing source or record fails closed. Draft/private state is checked for every source kind. The source union owns each public page once, with independent ordering for each view.

Collection blocks, listings and collection feeds follow the source's configured order. Manually selected blocks keep the order of their entries. Editable static pages bind to their published URL and language. Topic pages share a site-owned translation group, and their public page and RSS addresses stay usable after migration.

Explicitly selected PDF attachments can be up to 1 GiB each; other native attachments retain their 32 MB limit. PDF, office/presentation (including ODP), media and supported design files remain downloads, never executable website content. Attachment snapshots and their public construction copies are hashed and copied in bounded chunks, so large PDFs are not loaded completely into Python memory. Changed, missing, oversized or substituted files stop the preview; partial copies are removed. Preparing a local preview neither publishes files nor changes their permanent OneDrive availability setting.

Pages use configurable blocks; global theme tokens, local fonts, page/block adjustments and advanced CSS compile in ordered cascade layers. Generated files are never the editing source. Themes and source changes are reviewed before activation. Search, feeds and sitemap are regenerated with the artifact.

Appearance separates the primary/accent/secondary brand palette from general backgrounds, surfaces, text and muted text. Header, body, footer and primary-button groups assign palette references, white, black or custom colours; an unassigned role inherits the current appearance. Palette references remain linked when their source colour changes. The light secondary brand colour is distinct from muted text. Logos retain their original pixels: choose a contrasting header background rather than automatically placing the secondary colour behind a logo containing that colour.

Regional colour assignments use the `appearance` cascade layer, after components and before page/block adjustments and advanced CSS. When regional assignments are enabled, legacy unlayered stylesheet rules are placed in the components layer without modifying their saved source. Websites with no regional assignments retain their previous stylesheet behaviour. Existing theme tokens, file references, fonts and unrelated custom values survive autosave and theme export/import.

Device-private publication receipts, asset snapshots and operational SQLite live under Gnosi’s local data directory, scoped by workspace/vault/site. SMTP credentials use Gnosi’s credential store. Contact recipients, message contents, subscriber lists and delivery records never enter a public snapshot or the synchronized editorial files.

## Preview and publication

Review an immutable snapshot, inspect the change list and desktop/mobile preview, then publish the reviewed version. Source/configuration changes invalidate the review. Jobs persist phases, actor identity and release receipts; startup recovery checks current membership and plugin enablement before resuming. Local servers have explicit start/status/stop controls verified against the owned process identity.

SSH destinations require an owned isolated namespace and an explicit public document root/private service location. Uploads are integrity checked before an atomic pointer change; uncertain acknowledgements reconcile against the exact owned pointer and manifest. Rollback preserves message, consent and campaign state. Scheduled local publication requires the host to be running; a stopped host recovers pending work when Gnosi restarts.

SSH connections are provider-neutral: configure host, port, remote user, paths, authentication (system agent, explicit private-key file, or password) and file transfer (SSH/SFTP) in **Hosting**. Passwords are explicitly stored in the device credential manager and never in synchronized site JSON or API responses. The exact remote account owns each credential. Both protocols require a verified system SSH host key; no automatic trust is granted. An encrypted private key can be loaded into the system SSH agent.

SFTP transfer keeps the same owned namespace, digest verification and atomic activation contract as SSH upload. Publication still requires remote SSH commands, PHP 8 and PDO SQLite for the private service. The connection check can report a successful SFTP login separately from unavailable publication capabilities; SFTP-only shell-less accounts cannot publish this service.

## Temenos publishing

Content comes from Gnosi's selected native pages and tables. Once imported
collections and selected assets have native bindings, construction does not
require the former content snapshot. Retained archive assets are local data.
Canonical content addresses come from the table's `URL` field, resolved by its
stable field ID and registered aliases. An owned website URL takes precedence
over an earlier release. English articles use `/en/title-slug`; changing a title
or withdrawing and restoring a record keeps the address stored in `URL`.
Duplicate owned URLs, including those of withdrawn records, require correction
in the table before publishing. No per-record route history or new local metadata
is written. Historical identity metadata remains data.

Pangea uses Gnosi's native SSH/Suweb transport and the existing registered vault
list. It never loads or executes scripts from the former website pilot.
`GNOSI_PANGEA_CONFIG` selects an administrator-owned JSON registration with
`target: "staging"`, `vault_paths` and an absolute `remote_root`. The registration
authorizes the bridge; production still requires its separate existing
registration. SSH host/user/port come from `SSH_HOST`, `SSH_USER`, `SSH_PORT`;
passwords use the existing environment or system credential store. There is no
CMS connection or database operation in the publishing path.

`GNOSI_WEBSITE_IMPORT_ROOT` optionally selects a static archive for a new import.
The previous `GNOSI_WEB_PUBLISH_DRIVER` setting is accepted only to locate that
archive and its registration file; the named Python file need not exist.
Archived pages, assets and translations remain available as imported data.
Native records override matching public identities, and internal resource
exclusions remain. Private service data stays outside the document root.

## Forms, subscribers and newsletters

The form editor configures arbitrary supported fields, their order, localized labels/help/placeholders, validation, confirmation, privacy description and consent captions, optional newsletter signup and private delivery settings. Validation and submission-error messages also accept localized overrides; leaving them blank keeps the language default. A receipt is stored before notification. Review submissions under Messages; failed mail remains visible and retryable without losing the receipt. Public forms support JavaScript and no-JavaScript submissions.

The private service manages double opt-in, list/global restrictions, suppression-preserving imports, immutable campaign previews, queued schedules and uncertain delivery reconciliation. The daemon runs independently of Gnosi with a per-site lock and heartbeat. Full private protocol and worker setup are documented in [server/README.md](server/README.md).

In **Newsletters**, add already published contents to an automatically saved draft. Choose a digest or featured-reading template, add an introduction and reorder up to 20 unique pages. Only the active release at the selected destination and language is available. Withdrawn or other-language selections are flagged; a changed publication requires refresh and review. Generated links preserve the published deployment prefix. Review HTML, plain text and recipients before explicitly queuing a test; manual HTML/text remains available. Private per-destination drafts use revision checks and never enter publication bundles or website rollback.

In **Newsletters → Delivery queue**, captured rows offer **Read email**. Administrators can read the subject, sender, recipient, date and plain text, or an isolated HTML preview without navigation, scripts, forms or remote images. Reading never follows lifecycle links. Verified confirmation, preferences and list/global unsubscribe links have explicit **Test link in Gnosi** forms; they use the same token operation as the public POST handler, restricted to the captured synthetic recipient. Used, expired and suppressed links are unavailable. **Open on pilot** is optional and retains the pilot’s normal HTTP authentication. Captures never become public files or synchronized editorial data.

The former staging-only `/api/vault/web-publishing` API is retired. Its status
reports unconfigured, and its publication/newsletter operations return HTTP 410
without executing an external publisher. Use native Webs publishing and each
destination's private service; existing production registration and delivery
policies remain enforced.

## Verification

```sh
.venv/bin/python -m pytest backend/tests/test_sites.py backend/tests/test_sites_rendering.py backend/tests/test_sites_captured.py
php extensions/web-publishing/server/test.php
python3 extensions/web-publishing/server/test_http.py
```

Use the repository’s focused frontend checks, API generator and full pre-PR gate as well. All test data is disposable; no verification command sends real email or changes the production website.

## Header actions, page buttons and public listings

In **Webs → Navigation → Header actions**, add an action with its label, destination, language and appearance (link, filled button or outline). For example, a Catalan **Col·labora** button can point to `/ca/collabora`. Add separate language-specific actions for translated destinations, or select all languages for one shared destination. Reordering and removal use the existing editor controls. Main navigation and footer links can use the same appearance options. Internal links remain inside the selected publication prefix; external links keep the existing safe new-tab policy.

Split blocks in **Pages** expose their own action list, including the imported homepage hero. An explicit empty list removes its buttons; older imported configurations without this field retain their historical fallback until edited. New imported sites receive editable actions from their existing public pages.

Each source exposes **Items per page** (1–100) and an optional public area filter. Listings paginate only already selected public records, and the filter contains only their public tags. The page/tag query can be bookmarked and browser Back restores it. Public records remain available without JavaScript. Imported article and design collections retain images and excerpts; research/story lists retain publication years. Responsive navigation provides a keyboard-accessible mobile toggle and preserves desktop navigation.

These options participate in the existing configuration autosave, review fingerprint and publication workflow. Saving configuration does not publish it. Existing withdrawals and private-content exclusions remain authoritative. New imported contact forms require their configurable privacy acceptance; existing form settings are preserved.

Select and radio fields keep stable submitted option values with optional captions for each language. The privacy policy link caption is editable separately from the consent checkbox text. Existing forms retain their original option and privacy captions when these settings are blank.
The public retry form also preserves translated captions, hints, selected values and consent choices without JavaScript. New websites use neutral theme metadata; explicitly imported pilot themes retain their name.

## Editorial file fields

Logo, favicon, fonts, block images, gallery entries and file-link fields use the
same upload modal. Raster images show scoped thumbnails; other supported files
show authenticated download links. Uploads are capped at 4 MB, remain private
until an enabled public reference is published, and do not save a configuration
revision by themselves. Public file links are snapshotted into the reviewed
bundle, including CTA links, split actions and form privacy attachments. SSH
identity files instead use the existing local filesystem picker and stay in
private connection configuration.

The Contents editor uses `/api/vault/sites/catalogue/snapshot`: existing registry
and imported choices plus cached page-index metadata, without scanning Markdown.
`pages_ready:false` is an explicit incomplete-index state; it never triggers a
cold full-vault scan. Publication still validates authoritative source files.
The loopback preview serves static attachments in bounded chunks and answers HEAD
requests with the complete file size, so large selected PDFs do not require an
equally large PHP heap.

Native resource detail pages display the selected full citation, attachment
download buttons and tags without repeating the raw property list. Empty values
are omitted. A section heading followed only by omitted work views is excluded with those
views. Sections containing authored prose, code or subheadings are preserved.

### Table eligibility and public properties

Table settings expose only **Publishable to websites**. This table-wide capability
is stored independently of website sources. Enabling it does not select records,
fields or attachments, and never publishes or withdraws content. Configure those
choices in **Websites → Content**. Existing enabled native table/view and table-row page bindings
retain eligibility on upgrade; new, unbound tables require explicit opt-in.
Turning eligibility off preserves source settings and blocks their publication
until the source is disabled or table eligibility is restored. Schema autosaves
cannot overwrite this independently saved capability.

Public Markdown excludes native work views and standalone plain-label property
lists headed by an unselected schema field (for example `## Àrees` followed by a
bullet list). Authored paragraphs, code, links and unrelated sections are retained.
The original note is never rewritten. Field permissions are combined before body
projection when multiple sources explicitly select the same record.

Resource download buttons suggest the public resource title as the filename,
remove filesystem-reserved characters, preserve the file extension and distinguish
multiple attachments with a numbered suffix. Internal content-addressed asset URLs
remain stable.

Unchanged Markdown bytes can be reused between previews only with authenticated private storage and fresh complete POSIX file-version/path checks; both source scans and independent confirmation reads remain. APFS uses independent copy-on-write attachment staging with complete hash verification, and other filesystems stream normally. SSH and legacy-Pangea transfer only changed public files, copying unchanged verified parent bytes into a complete immutable candidate under the publication lock. Removed paths are excluded; complete manifest verification, atomic activation and rollback remain. Private service/config refreshes stay separate.

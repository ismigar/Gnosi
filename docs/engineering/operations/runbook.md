---
status: implemented
last_verified: 2026-09-09
source_paths:
  - package.json
  - pyproject.toml
  - pnpm-workspace.yaml
  - pnpm-lock.yaml
  - uv.lock
  - scripts/runtime/run_native_dev.sh
  - scripts/runtime/run_native_frontend.sh
  - scripts/check_public_runtime.py
  - frontend/vite.config.js
  - frontend/src/app/App.tsx
  - frontend/src/shared/plugins/usePlugins.ts
  - backend/app/health_contracts.py
  - backend/domains/calendar/timing.py
  - backend/utils/request_profile.py
  - backend/config/data_dir.py
  - backend/config/env_config.py
  - backend/config/paths_config.py
  - backend/platform/files/__init__.py
  - backend/platform/files/local.py
  - backend/platform/files/on_demand.py
  - backend/platform/files/onedrive.py
  - scripts/migrate-data-dir.py
  - backend/services/data_dir_migration.py
  - docker-compose.yml
  - compose.vaults.yml
  - Dockerfile.backend
  - Dockerfile.frontend
  - desktop/package.json
  - desktop/backend-launch.js
  - desktop/build-python.sh
  - desktop/electron-builder.yml
  - .github/workflows/build-release.yml
  - .github/workflows/documentation-pages.yml
  - tests/e2e/tests/setup/auth.setup.ts
  - tests/e2e/support/auth-playwright.ts
  - tests/e2e/support/auth-state.ts
tests:
  - pipeline/tests/test_native_runtime_wrappers.py
  - frontend/src/app/App.pluginRecovery.test.tsx
  - frontend/src/app/App.loginPluginRecovery.test.tsx
  - backend/domains/calendar/tests/test_timing.py
  - backend/tests/test_request_profile.py
  - backend/tests/test_graph_request_timing.py
  - backend/tests/test_vault_creation_membership.py
  - backend/tests/test_data_dir.py
  - backend/tests/test_env_loading.py
  - backend/tests/test_data_dir_migration.py
  - backend/tests/test_health_api_contract.py
  - backend/tests/test_files_provider.py
  - desktop/backend-launch.test.js
  - desktop/packaging-contract.test.js
  - desktop/packaging-resources.test.js
  - tests/e2e/tests/anon/smoke.spec.ts
---

# Operations runbook

This guide describes contracts reviewed in public source. The verification date
records that review, not a successful installation, migration or release on
every platform. Commands below are operator instructions, not evidence that
they have been executed.

Browser liveness uses the same process-wide snapshot as native probes: an
active-vault cookie, header or query does not trigger vault resolution for the
exact `GET /api/health` route. Other paths and methods retain normal routing.
Auth-policy autodetection shares only pending reads, with HTTP followers awaiting
one task rather than consuming blocked worker slots. The existing five-second
TTL still starts at the original read; reset retires the pending generation,
explicit environment overrides remain fresh, explicit database sessions bypass
reuse, and errors continue to require authentication.

Native personal mode opens without registration for every local profile.
Additional account rows do not enable authentication: anonymous requests reuse
the stored personal workspace owner, preferring established owners over generated
placeholders and then the oldest membership. Before the workspace exists, the
oldest established account is reused; an empty installation bootstraps its local
identity. Organization/exposed deployments and explicit authentication overrides
retain their credential requirements.

Settings groups plugin-owned editors under Plugins instead of duplicating their entries in the general sidebar. The plugin list, third-party installations, catalogue and updates follow alphabetical display-name order in the current interface language. Existing References entry points open the References plugin directly; other plugin editors retain their configuration actions and a return button to Plugins.

## Native development first

Run the FastAPI backend and Vite frontend natively. Docker, Electron, cloud
storage and macOS LaunchAgents are optional. Use Python 3.11, Node 22.22.2 and
pnpm 11.19.0; the current CI and Docker backend pin uv 0.9.15. From the repository
root, prepare dependencies from the committed locks:

```sh
uv sync --frozen
corepack pnpm install --frozen-lockfile
```

Start the backend and frontend in separate terminals, each at the repository root:

```sh
bash scripts/runtime/run_native_dev.sh 5002
```

```sh
bash scripts/runtime/run_native_frontend.sh --config vite.config.js --host 127.0.0.1
```

The backend wrapper uses the existing root environment through
`uv run --project "$BASE" --frozen --no-sync`, calls the canonical Python
`load_env()` and `resolve_data_dir()`, then starts uvicorn on loopback with
reload limited to `backend/`. It does not synchronize or install dependencies.
It neither parses dotenv in shell nor forces a OneDrive vault, provider,
`HOME_HOST_PATH`, timezone, model or translation endpoint.

The frontend wrapper sets `COREPACK_ENABLE_NETWORK=0` and runs
`corepack pnpm --filter @gnosi/frontend dev`; pnpm and the locked dependencies
must already be available. The example passes an explicit Vite configuration
and loopback host; without `--host`, Vite's configured host applies.
Set `VITE_BACKEND_HOST` and `VITE_BACKEND_PORT` explicitly for another backend
(defaults: `127.0.0.1` and `5002`). Vite owns frontend dotenv loading; the
wrapper does not export a default `VITE_FRONTEND_PORT` that would shadow it.
Both wrappers validate supplied ports in the range 1–65535, forward arguments
and propagate process exits. The frontend preserves explicit checkout labels
and reports an already-merged checkout behind `origin/main`.

For everyday native use, build once and serve the compiled application:

```sh
corepack pnpm --dir frontend run build
GNOSI_NATIVE_FRONTEND_MODE=preview bash scripts/runtime/run_native_frontend.sh
```

Preview uses the same strict port, HTTPS certificates, HTTP-to-HTTPS redirect
and backend proxy. It serves an isolated copy of `frontend/dist`, so a later
build cannot remove assets from the running application. Shutdown removes only
that process's copy. Build again and restart to apply source changes; the default
`GNOSI_NATIVE_FRONTEND_MODE=dev` retains live source updates. A missing build or
an invalid mode fails explicitly. A managed LaunchAgent can select preview with
that environment variable; reload the job after changing its stored environment.

Compiled builds include a Vite manifest. Preview uses it to identify exact,
content-hashed public assets and serves them with immutable browser caching on
successful GET/HEAD responses, including 304 validation. HTML, API responses,
missing assets, unlisted public files and other methods retain their existing
cache policy. Changing content changes its compiled URL; the HTML entry still
revalidates to discover the current build. Older builds without a manifest keep
Vite's original policy. This removes repeated asset revalidation after a browser
has received the new headers; it does not remove first-download or API latency.

Startup lets routing and health requests pass through their asynchronous
middleware before scheduling route and shell downloads. This yields one browser
turn, without waiting for either response; rendering still respects routing and
language readiness. The build groups only the 51 explicitly reviewed shell
icons. Other icons and heavy routes remain lazy, and shared icon dependencies
keep automatic placement. After changing this group, check the compiled import
graph for new cycles and unexpected initial dependencies, as well as byte budgets.

An invalid optional session cookie is ignored while local personal access is
allowed, so an expired session cannot introduce a registration or login step.
Where credentials are required, `/auth/me` distinguishes an invalid cookie from
an ordinary anonymous 401. The interface offers an explicit session recovery
action: it calls the existing logout endpoint, clears local identity metadata
only after success, and reloads the application. A failed logout keeps recovery
available. This does not change authentication policy or public shared-page access.

An explicit protected-route 401 with `Authentication required` is a different
case: when `/api/auth/me` reports an anonymous user, present Login rather than
diagnosing an expired cookie or prompting logout. The plugin catalogue's
server response takes precedence over an earlier health snapshot reporting
authentication disabled. The `authenticationRequired` source correction in
`usePlugins` and App has 17 focused tests, a focused type check, existing-file
lint and a compiled build passing. One additional App integration test verifies
that login in the same vault reloads plugins and leaves Login; its lint also
passes. Trusted-TLS activation and the live Login screen are verified; no
real login/logout or credential reads were performed. See the remaining
calendar timing work in the [navigation latency audit](navigation-latency-audit-2026-09-08.md).

Privileged Python profiling is not the only diagnostic path. Opt-in calendar
duration instrumentation using `X-Gnosi-Calendar-Timing: 1` and `Server-Timing`
is implemented and activated for the calendars/events routes. It reports
queue, credential-resolution and HTTP timings without exposing credentials or
calendar content. Only the `CalendarTiming` context is propagated; vault and
authentication contexts and query results are unchanged. Timings are inclusive
and may run concurrently, so do not add them to reconstruct the total.
`cal_total` excludes middleware and response validation and is not the full
HTTP duration. `cal_service` includes facade access, discovery imports before
nested credentials and client construction; it is not pure `build` time.
The 35-test calendar batch, a repeat of its 9 new tests, Ruff
and mypy passed. Live data-access verification returned HTTP 200 with one
calendar and two events visible after 10.557 s. The earlier 47–52 s server
wait was not reproduced; unexplained local intervals remain, and this diagnostic
change does not establish an attributable overall latency improvement. This
path requires no administrative authorization.

An in-process Python sampler is implemented for graph requests with
`X-Gnosi-Graph-Profile: 1`, and calendar event requests with both
`X-Gnosi-Calendar-Profile: 1` and `X-Gnosi-Calendar-Timing: 1`. It allows one
sampler at a time, for up to 15 s at 20 Hz, observing the main thread and
explicitly registered workers. It records normalized code filenames, function
names and line numbers only, without locals, globals, arguments, thread names,
user data or mail tracing. Aggregate output is limited to 256 stacks of 32
frames and includes the process ID and monotonic start time. The mode-`0600`
file `/tmp/gnosi-request-profile-<id>.json` is saved at the 15 s deadline even
if the request is still pending. Stopping waits at most 250 ms; the response
includes `X-Gnosi-Request-Profile-Id` when persistence is already complete.
No administrative authorization is needed. The 35-test sampler/calendar/graph
batch, Ruff, mypy and backend activation passed. Graph and calendar captures
completed without administrative privileges.
The graph capture had 39 sampling observations in a maximum 15 s window,
33 aggregate stacks and none dropped. The nominal 50 ms interval was not
constant in practice: do not multiply observation counts by that interval to
derive durations. An uvloop runner frame does not distinguish idle time from
native C work. The subsequent calendar capture had 34 observations, 19 stacks
and none dropped; worker wait and discovery-cache frames are observations,
not additive elapsed durations. These limits describe diagnostic collection,
not a latency fix. JSON decoding, bounded metadata-cache admission and Google
static-discovery corrections are implemented and validated: 80 unique test
cases, Ruff, mypy and the diff check passed. Backend activation completed in
185.3 s. Subsequent direct openings with timing only and cached compiled assets
showed the graph after 22.128 s and fresh calendar data after 16.081 s. These
measurements do not demonstrate a broad latency improvement or the 0.5 s goal.
Final warm navigation showed graph data after 7.447 s and fresh calendar data
after 5.392 s; calendar data already loaded was visible at 398 ms. Keep visible
and fresh-data timings separate. Verification and cleanup are complete, while
the latency objective remains partial. The native snapshot HTML was restored,
the timing script and both created profiles were removed, and the accessible
loopback calendar was returned to Month without an audit query. HTTPS returned
200 with successful TLS verification and `no-cache` HTML; HTTP redirected with
307 to HTTPS, and compiled assets retained one-year immutable caching.

For a local vault, configure its actual directory and select
`GNOSI_FILES_PROVIDER=local`; no download helper is required. Keep the active
vault separate from the parent directory containing multiple vaults.
`DIGITAL_BRAIN_VAULT_PATH` takes precedence over `VAULT_HOST_PATH`; the latter
also informs provider detection. Without an environment override, the backend
can use the vault selected in Settings.

| Service | Default address | Check |
| --- | --- | --- |
| Frontend | `http://localhost:5173` | Sign-in or application shell loads; navigation works. |
| Backend | `http://127.0.0.1:5002` | `/api/health`, then authorized config and vault requests. |

Vite uses `strictPort: true`: resolve a port conflict instead of accepting a
fallback port. HTTPS is optional: automatic mode uses readable local
certificates; `VITE_DEV_HTTPS=false` forces HTTP and `VITE_DEV_HTTPS=true`
requires certificates. Restart Vite after certificate changes. Source changes
reload; dependency changes require synchronizing the locks and restarting the
affected process. Restart the frontend for startup-injected version values.

The managed native frontend sets `pnpm_config_verify_deps_before_run=warn`
by default, preserving an explicit override. A service restart must not trigger
an implicit dependency reinstall when another task changes workspace manifests.
Install and synchronize dependencies explicitly before restarting the affected
server; the warning is not proof that installed dependencies match the lock.

For trusted local HTTPS, install `mkcert` and run
`bash scripts/runtime/setup-https-dev.sh`, then restart the frontend process.
The setup installs a local certificate authority in the machine's trust store
and generates ignored certificates under `frontend/certs/`. With those
certificates, `https://localhost:5173` serves the application and plain HTTP
redirects to the same path and query over HTTPS. The certificate files alone
are insufficient if the local authority is not trusted by the browser.

Native development uses filesystem notifications. Set
`CHOKIDAR_USEPOLLING=true` only for filesystems or container bind mounts that
need polling. Vite warms the application shell, Knowledge and Control Center
on startup; the other screens remain lazy and preload on navigation intent.

Initial language and record formatting use `/api/config/interface`, a small,
vault-scoped display-preference response with the same permission gate as
configuration. It reads no credential status; `/api/config` remains the complete
configuration response, including credential indicators. Editors and the Control
Center read `/api/config/editor`, which retains editable fields and extensions,
normalizes provider references and defaults, and excludes plaintext credentials
and read-only availability indicators without querying credential stores. Saving
configuration invalidates the corresponding frontend caches. Editor reads share
only overlapping requests per vault; later reads revalidate immediately.
Settings hydrates its editable documents once per modal opening, including when
development mode replays mount effects. Closing and reopening still requests
fresh configuration, integration and identity documents.
Field and record selectors reuse one locale collator per sort. Planning settings
retain sorted tables, projects and tasks until their data or locale changes,
so editing unrelated fields does not reorder hundreds of choices again.

Vault routing resolves cold SQLite/cloud-folder lookups in workers. Concurrent
requests for the same identity share one lookup; the 60-second identity cache is
invalidated by vault changes, including lookups still in flight. The active
vault context is set in the request task after lookup, before endpoint dispatch.
Overlapping HTTP readers await a shared task rather than occupying workers while
another worker resolves the same identity. A disconnected reader cannot cancel
the lookup needed by other requests.

Configuration readers reuse successful directory preparation for up to 30 seconds,
bounded to 256 paths. YAML, vault selection and file reads retain their normal
freshness and permission checks. Failed preparation is retried, and direct
`get_paths()` calls still check and repair immediately. If a prepared directory
is removed, a configuration read may defer its recreation until this interval
expires.

Mail account reads resolve credentials only for the selected account (or enabled
mail accounts during synchronization), excluding unrelated integrations. Mail
folder reads, calendar reminders and graph construction run in workers, including
configuration/registry loading. Settings loads auxiliary model, calendar, reader
and social data when opening the section that uses it. The graph displays ready
data immediately without a minimum loading delay and reuses the resolved vault
configuration path when reading managed metadata for each node. When a page index
is available, graph discovery uses its paths and modification times, avoiding a
second cloud filesystem walk. Unchanged nodes retain their full cached body links;
changed nodes are reparsed. An absent or foreign legacy index falls back to the
filesystem walk. Index freshness follows the existing watcher/background refresh.
The parsed-node disk cache is written only after a node changes. Persistence
encodes one snapshot and uses the atomic writer instead of millions of small JSON
writes. Concurrent initial readers wait for one complete load; changes arriving
during a save remain dirty, and failed saves are retried on the next rebuild.
Persistent graph node caches are partitioned by vault path under
`LOCAL_CACHE/graph_nodes/`. A vault without its own cache reads its entries from
the legacy `graph_node_cache.json` once and writes its partition; the legacy file
remains intact for other vaults. Loaded and dirty state is tracked separately per
vault, so opening one does not require decoding every other vault's old entries.
An adjacent metadata file binds parsed nodes to their classification, colours
and managed sidecars using a digest of the actual node JSON. Older caches or
mismatched markers require one regeneration. Markers are published only after
a complete successful build and save; failed or partial reads remain retryable.
The graph viewer lets Sigma render its batched topology, visibility and position
updates without forcing a second complete reindex per layout tick. Hover changes
still invalidate their display state. Initial projection and visibility filters
are applied before constructing Sigma, so its first index sees the prepared
topology. The timeline uses its effective initial cutoff before committing that
value to state, avoiding a second initial D3 simulation for the same data and
filters; later timeline changes still update the layout.
The minimap coalesces graph, camera and
renderer events into one paint per frame, batches node circles, resizes only when
needed and cancels queued work on replacement/unmount. Delayed camera fits are
also cancelled when their graph view closes or changes.
Graph field-filter counts reuse the already normalized filter graph and traverse
its nodes once for all configured fields. Metadata is normalized only once per
node; counting preserves table classification, case-insensitive field lookup,
repeated values and the stable order of equal counts.
The page fetches the global title index only when configured field filters need
it. Those filters retain the canonical index's title precedence. Graph, table,
configuration and index queries are scoped to the active vault; embedded graph
views share the same graph query and prefix invalidation.
Each backend graph batch also resolves a table's relation field names and aliases
once, including tables with no relations. This cache belongs only to that batch;
the next build reads its current registry schema, and cached page metadata is
never modified when converting relation wikilinks to IDs.
The graph API retains one validated JSON body for the current graph snapshot,
checking the service's current object before reuse. Rebuilds and invalidations
replace that object, partial graphs are never retained, and failed validation
cannot publish a body. Encoding runs in the request worker; response headers and
background tasks remain independent for each request.

Media roots, tree, album, view and page reads also run in workers so cloud-folder
latency does not block unrelated requests. A media page resolves each vault/root
once within that request; the scope is discarded after success or failure.
Concurrent reads of the same contained media tree share only their pending work.
Parent and child directory listings have a shared global limit of four scans,
preserving folder filters and stable ordering. There is no tree TTL: later requests
read current directories, and failures are not retained for a later request.
Persisted media indexes retain validated path strings and modification times in
an immutable sequence. Default pagination constructs `Path` objects only for the
selected page, rather than every indexed file. Loading still validates the entire
index; filters and custom sorting still inspect every applicable entry. The JSON
format and 24-hour freshness interval remain compatible. When that interval
expires, the browser API returns the stored snapshot while at most two workers
refresh it; the combined running/pending queue is bounded to eight jobs. Requests
for the same index share that work. A first index without usable stored data
still waits for its initial scan.

`GET /api/vault/media` reports `X-Gnosi-Media-Index` (`fresh`, `refreshing`, or
`failed`), an opaque `X-Gnosi-Media-Index-Revision`, and
`X-Gnosi-Media-Next-Offset`. The body keeps its existing contract. Files removed
since the snapshot are omitted from items, but its slots and total stay stable;
consumers advance by the next-offset header, including empty windows. Failed
refreshes retain the stored snapshot and return a `Retry-After` cooldown of up
to 30 seconds. The gallery polls a refresh every five seconds, up to 60 times,
then offers manual retry. It retains loaded photos and replaces their entire
loaded prefix only after matching revisions across pages. Root, album, filters,
vault changes and unmounts cancel requests and timers.

Partial scans cannot replace a complete index. Invalidation retires the
publication generation and persistence replaces an encoded temporary file
atomically. A fully read index remains usable in memory if writing its cache
fails. Legacy Python callers retain blocking reads and best-effort partial
results, but do not publish partial scans. The historical JSON format cannot
retrospectively certify that an old index was complete; its structure is
validated when loading it. A cache that cannot be written does not survive a
process restart.

Social configuration resolves only its own integration section, preserving explicit empty
lists and default settings without opening unrelated credentials.

Unhandled-error notifications run in a worker so their database, file and native
notification I/O cannot block unrelated HTTP requests. Deferred scheduler startup
also runs in a worker. Cancellation waits for its in-progress start before
shutdown calls stop, preventing a scheduler from starting after it was stopped.
These boundaries preserve request ContextVars and the existing safe 500 response.

Plugin settings loads installed plugins and permissions independently of the
marketplace. Catalog and trust data load when their section opens, and a pending
trust read does not hide a ready catalog. Failed reads show a retry action before
configuration becomes editable. The backend reuses decoded plugin state only when
the file's modification time, change time, size and inode match; saves invalidate
it, and every returned document is an independent copy scoped to its file path.

The browser entry starts vault routing and the requested screen download before
loading React DOM and the application shell. It shares the pending routing read
with the shell, which still waits for routing and interface language before
rendering. The entry sets the active-vault cookie before any initial requests.
The routing read starts before speculative screen imports and carries a high
fetch priority; browser scheduling still needs to be measured on the target host.
Build budgets separately bound the code needed to start those requests and retain
the required dynamic bootstrap in the complete startup budget.
The vault catalog reads mode and default storage from one configuration snapshot
per request; subsequent requests still read the current configuration.

Project-planning selectors request every page ID and title from the table's
`references` endpoint. It uses the same template filter and title hydration as
the full table response, but does not transfer unused metadata. Concurrent reads
share only an identical vault, table and filter; later reads revalidate immediately.
An open settings editor cancels its table/reference reads on a vault change and
does not display results from the previous vault, even if table IDs coincide.
On the local 748-task/45-project dataset, these two decoded responses totalled
67,381 bytes instead of 1,130,202 bytes (94.04% less), with identical ordered
IDs and titles. The measured reference requests took 118 ms and 22 ms; this
does not establish the elapsed time until the complete settings form is usable.

The calendar mounts its grid while local notes and preferences are loading, so
FullCalendar's actual visible range can start external event reads concurrently.
The grid is hidden and inert only on the first local read without usable data.
Complete local sources live in a vault-scoped query and revalidate on every open
(`staleTime: 0`). Reopening displays that snapshot and completed same-range events
while an activity indicator identifies pending refreshes; the external event
freshness interval remains 30 seconds. A partial refresh cannot overwrite the
last complete local snapshot. A first partial result can still show useful notes,
with an explicit error and retry. Calendar lists, ranges, reminder queries and
mutation invalidations are vault-scoped; previous-range placeholders never cross
vaults. Saved visibility is applied before selecting early-arriving calendars.
Refreshing notes retains the grid instance, selected period and view.
Deferred-response tests exercise the real FullCalendar remount with an aged
same-range result; visible cached content and freshly completed data must be
measured separately in the host browser.

Settings no longer imports Lucide's complete component registry. The agent icon
picker loads searchable names on opening and renders only requested icons,
including saved numbered aliases. The build checks the transitive static settings
imports, not just its entry file size, to prevent thousands of small icon downloads.
Autosave establishes its baseline only after all editable documents finish loading;
opening or closing a slowly hydrated settings session must not trigger writes.
The same configuration response supplies sanitized AI provider settings. Hydration
does not fetch the entire provider/model catalog a second time just to obtain those
fields; credential references, availability flags and provider extensions survive.
Settings editors load with their selected section, and secondary dialogs load only
when opened. The installed-plugin list similarly defers each built-in plugin editor
until its configuration opens. Loading indicators stay within the selected content
so the settings navigation and close button remain available.

The mail inbox loads its reader and composer only when a message or draft opens.
Its empty detail pane is independent of the rich-text editor and calendar tools;
the inbox and a close action remain available while either module loads. Calendar
event forms, availability tools and global search similarly load on opening,
without changing draft autosave, event visibility or recurrence handling.
Title previews defer their page card and Markdown renderer until a title is
hovered or opened from the keyboard. Pointer entry starts the module load during
the existing hover delay; leaving still cancels opening and navigation stays usable.
Build budgets cover the complete static import graphs for mail and calendar,
including shared startup code, so a small route entry cannot hide an eager editor.

Mail push subscriptions wait asynchronously; idle tabs no longer occupy the shared
worker pool between events. Thread-originated notifications retain account filters,
bounded ordering and cancellation/disconnect cleanup. Local mail views and tag
queries use synchronous FastAPI worker dispatch, preserving the active vault
context while leaving the request loop available. Cold hybrid-provider imports also
run in workers and are skipped on cached message reads.

Integration updates preserve secure-store references and resolve only changed
credentials. Reference-only configuration reads do not wait behind a reader that
is unlocking credentials. IMAP synchronization resolves the selected account from
either supported account section instead of unlocking every mail account.
Calendar provider dispatch reads account metadata without unlocking credentials.
Google and CalDAV clients resolve only matching calendar/email identities; Google
also filters by provider and OAuth authentication before accessing the secure store.
Calendar-before-email precedence and fresh credential reads remain unchanged.
Concurrent Google Calendar credential reads share only work still pending for the
same email, configuration document and revision/reference snapshot. Completed or
failed reads are removed immediately; later calls resolve credentials again.
Each caller receives independent credential data and constructs its own client.
Meeting-reminder state paths use `resolve_data_dir()` directly, without loading
vault parameters or creating directories during path resolution. The atomic writer
prepares the local parent directory when state must be saved.

Configuration reuses decoded YAML for unchanged files, checking device, inode,
size, modification/change times and permissions on every read. Concurrent readers
share a cold read of the same file; unrelated vaults keep independent reads and
all callers receive independent documents. Failed or unstable reads are not reused.
The cache retains at most 16 documents of up to 1 MiB each. Environment and active
vault selection remain fresh. Path discovery reuses only the module's checkout
location and checks existing directories before attempting creation; deleted
directories and changed data/vault selectors retain the normal repair behavior.

Credential availability resolves provider environment aliases from the current
catalog snapshot, local downloaded metadata or bundled metadata. It does not
refresh models.dev, probe Ollama, or wait on an ongoing model-catalog refresh.
Explicit model-catalog reads still refresh normally. Local alias indexes are
bounded and re-read after file replacement or modification; secret resolution
and sanitized `has_api_key` flags retain their existing precedence.
Concurrent credential checks share the initial decode of each unchanged catalog
file. Different files and replacements proceed independently; failed reads are
released and retried on the next lookup without retaining a failed cache entry.

Settings navigation and inline plugin editors use React transitions to keep the
current controls available while loading another editor. Concurrent table and
table-page reads share a request per vault, table and filter, including development
remounts; later reads always revalidate, and one dismissed consumer cannot abort
another.

Table page reads prepare current field names, immutable IDs and aliases once per
batch. Rows whose keys already need no renaming take a copy without collision
bookkeeping. Name/ID/alias precedence, original key order, opaque local metadata
and HTTP metadata validation are retained. Prepared maps stay inside one table
read; later queries rebuild them so renames and different vault schemas remain
independent.

The graph requests only its own configuration document at `/api/config/graph`.
That read inherits the existing configuration permission gate and vault context,
but never inspects AI provider or system-password credentials. The full Settings
document retains its sanitized credential-status behavior. Graph preference
refreshes still read current configuration after changes.
After projection, graph construction clears the temporary NetworkX adjacency
and attribute storage, including on partial results or failures. Its cached views
can otherwise retain that storage until a process-wide cyclic collection; the
projected response and parsed-node cache keep their data independently.
Embedded vault graphs use their explicit view options and do not fetch an unused
global configuration document on mount, configuration changes or partial retries.

The Settings entry point, its section navigation and built-in plugin configuration
buttons prepare their selected editor module on pointer, keyboard-focus or touch
intent. The same import loaders serve React.lazy; preparation never mounts a
section, reads editable documents or saves settings. Failed speculative downloads
are ignored so opening the section still owns normal loading/error handling.
Measure time from the click to populated, enabled controls separately from module
preparation and the first modal frame; moving a download before a click does not
prove that data hydration fits the navigation latency target.

Before accepting requests, startup visits FastAPI's included route validation
contexts in a worker without generating the optional public API schema or executing
endpoint dependencies. This prevents lazy route construction on the first browser
request while leaving schema generation and caching to its normal on-demand path.
Integration startup remains deferred until route preparation finishes;
authentication and parameter validation still run on each applicable request.

Vault schema revisions `vault_0005`–`vault_0006` add Reader indexes for publication date,
read status and source. It avoids scanning article bodies and sorting the whole
table before applying the list limit. The normal migration runner backs up the
database and verifies schema, integrity and row counts; article content and list
response fields are preserved. A covering inventory index prevents source/count
aggregation from opening article bodies. Query-plan tests cover the four list
variants and inventory aggregation.
The Reader UI requests `include_content=false` for its article list, keeping
metadata, filtering and order while leaving stored bodies out of the SQL query
and HTTP payload. Opening an article fetches its complete body separately; a new
selection cancels the previous request, and failures offer retry. The default
article-list API and direct article links retain their complete-content contract.

Planning treats an existing but unreadable state/history file, or a corrupt
state document, as unavailable, never as a new empty plan. Malformed individual
history lines still follow the existing skip behavior. Temporary provider errors return 503
with `planning_storage_pending` and `Retry-After`; read queries retry within a
bounded window, while mutations are never automatically repeated. Planning
query keys include the active vault, and previous-project placeholders are
reused only within that vault. The selected project is resolved from compact
page references before loading its schedule and baselines.

Image responses distinguish provider downloads still pending from confirmed
failures through `X-Gnosi-File-Availability`. The thumbnail retries only after an
actual image error, respects the retry delay, cancels on unmount and reuses the
successful response bytes. Failed downloads show a manual retry after a short
cooldown. A warmup request or an allocated file block does not prove availability:
the provider checks readability in a worker. Cloud download completion still
depends on the file provider and must be verified with real files.

A plugin-catalog timeout keeps feature gates closed and displays an explicit
retry action in the application shell and plugin route gate. A failed catalog
read is not evidence that plugins were disabled; do not replace its unavailable
state with an empty successful catalog.
Reads and pending activation/settings responses are scoped to the active vault;
a late success or rollback from an earlier vault cannot replace the current state.

Graph rebuilds coalesce per vault; cache hits avoid rebuilding the registry.
After 30 seconds, the service revalidates indexed paths/modification times,
registry data, contact columns, pending proposals, settings and managed sidecars.
An unchanged complete snapshot retains its graph object and encoded bodies.
Small successful sidecar reads reuse an LRU of at most 512 documents of 64 KiB
each, after checking device, inode, mode, times, size and allocation. Failed or
unstable reads are never retained; returned documents are independent copies.
A changed snapshot is rebuilt from the captured inputs and checked again before
publication. Unreliable inputs cannot renew a successful response. Sidecar reads
are strict and scoped to the request's vault; semantic changes also refresh that
vault's parsed nodes. Without a canonical index, normal periodic rebuilding
remains the fallback.
Graph JSON compression runs in a worker and reuses bytes for the same immutable
snapshot, preserving invalidation and partial-result handling. Mail folder counts
use a separate, short-lived connection so their scan does not serialize message
listing on its connection. Header listing fetches only the fields it consumes;
credential resolution remains fresh at provider use. Settings load tables and
databases concurrently and retain either successful result if the other fails.
Startup overlaps the health read with route preparation, sharing its pending
request with the authentication gate and sidebar.

Mail message reads retain their explicit error field when the provider cannot
connect, select/search the folder or fetch headers. Such responses never replace
a valid list cache or renew its freshness. Counts return retryable 503 on
failure or after the overall 30-second read deadline; a shared read may finish
in the background for another caller. Microsoft list/count GETs also use a
20-second network timeout, so the underlying worker is bounded. The UI publishes
successful account counts as they arrive and identifies pending/unavailable
accounts and any retained previous counts. A visible list or an HTTP200 message
response alone does not prove a successful fresh read of every account.
Invalidating counts also retires in-progress read identities, preventing an old
worker from publishing or renewing a pre-mutation count. Pagination publishes
each account's page independently. Failed pages preserve their cursor and visible
messages, and the retry action requests only those failed pages.

Measure both first reads and repeats, and distinguish complete API responses from
usable rendered content. A warm list under 500 ms does not establish a 500 ms
navigation budget: initial cloud scans, external catalogs, thumbnails and browser
rendering still require separate measurements.

## Frontend build and direct links

Run `corepack pnpm build:frontend` from the repository root. Its prebuild checks
include the actual Vite configuration contract. By default, assets use `/`, so
direct nested links and reloads resolve JavaScript, styles and icons from the
origin root. The same artifact suits HTTP hosting and Electron's standard
`app://gnosi` protocol; Electron does not require a relative `./` base.

`VITE_BASE_PATH` remains an explicit asset-base override. Setting it to `./`
reintroduces relative resolution on nested routes. An asset prefix does not
configure a router basename or establish support for mounting the whole app
below a URL prefix. Keep the default for the standard web and desktop layouts.
The HTTP server must return the SPA entry for application routes while serving
real assets and proxying `/api` to the backend. Vite preview already has that
API proxy; it is a validation server, not production deployment acceptance.

## Configuration and persistent data

Backend environment loading uses this order for each variable: process
environment, repository-local `.env`, then the shared file explicitly selected
by `GNOSI_SHARED_ENV_FILE`. No parent `.env_shared` is discovered implicitly.
The shared file is operator-owned and read-only to Gnosi's environment cleanup.
Native secure storage can supply missing credentials; it does not replace an
already populated value.

After loading, the data resolver chooses the first nonempty value in this
order: `GNOSI_DATA_DIR`, `GNOSI_LOCAL_DATA`, `LOCAL_DATA_DIR`, platform default.
Both aliases are deprecated but supported throughout 3.x. Configure the
canonical name consistently; a conflicting canonical value wins over an alias
even if the alias came from a higher-priority environment source. Prefer
absolute paths: relative data paths resolve against the process working directory.

| Backend runtime | Default data directory without an override |
| --- | --- |
| macOS | `~/Library/Application Support/Gnosi` |
| Linux | `$XDG_DATA_HOME/gnosi`, otherwise `~/.local/share/gnosi` |
| Windows | `%APPDATA%\Gnosi`, otherwise `~/AppData/Roaming/Gnosi` |
| Docker | `/data`; Compose mounts the named volume `gnosi_local_data` there. |

The old checkout-local `local_data` directory is not the native default.
Vault content and its `.gnosi/` configuration are separate from per-device
state. Keep `GNOSI_DATA_DIR` on local, unsynchronized storage outside the source
tree. Preserve `system/management.sqlite`, `system/tool_registry.sqlite`,
`system/checkpoints`, `secrets` and other required state before reinstalling or
migrating. Do not copy live SQLite files into a synchronized vault or run
independent Gnosi instances against the same data directory. Another device may
need OAuth reconnection because credentials and secure storage are local.

For a deliberate move, inspect `scripts/migrate-data-dir.py`: it exposes
`plan`, `migrate`, `status`, `rollback` and `finalize`. Planning may create
the destination parent, so it is not a purely read-only diagnostic. Stop all
writers before migration or rollback; `--writers-stopped` is an operator
confirmation, not a process detector. The service journals progress, checks
SQLite integrity and checkpoints WAL. It uses a same-volume rename or a verified
staging copy across volumes, preserving the source in the copy case. Retain the
journal and backup, verify the destination, then configure `GNOSI_DATA_DIR`
before restarting. Merely changing the variable does not move existing data.

## First diagnostic sequence

1. Identify the selected runtime, checkout, process owner and listener on each
   application port before starting or restarting anything.
2. Inspect that runtime's backend/frontend logs; do not assume LaunchAgent paths.
3. Read `/api/health`: `status`, `mode`, `gnosi_mode`, `require_auth` and
   `vault_configured`. A liveness response does not prove vault readability.
4. Use an authorized session for `/api/config` and `/api/vault/pages`.
   Distinguish authentication or permission failures from an empty vault or I/O
   failure; redact credentials and private paths before sharing diagnostics.
5. Confirm the active vault, effective data directory and selected provider.
   Do not reset settings or replace databases to repair a wrong path.
6. Reproduce the affected UI action while checking browser console and backend
   logs, then run the narrowest relevant test.
7. After a targeted repair, verify both the returned data and the visible action;
   a process restart alone is not recovery evidence.

## File availability and provider-specific recovery

Start with the selected adapter in `backend/platform/files`.
`GNOSI_FILES_PROVIDER` selects a known provider explicitly; otherwise detection
uses `VAULT_HOST_PATH`. `LocalProvider` performs no hydration. A provider name
or shared interface does not certify every cloud client's behavior on every OS.

On macOS File Provider storage, `EDEADLK` or `EAGAIN` can indicate unavailable
online-only files. These errors alone do not prove a provider fault or a
Markdown parser fault: check the exact path, file flags, downloaded blocks and
client state. Retry the smallest affected scope with bounded, sequential
attempts; do not turn a partial recovery scan into a complete index or replace
unreadable content with empty files. Keeping critical directories downloaded
locally can prevent recurrence.

The current on-demand adapter defaults to `open` on native macOS, delegating
reads to a GUI application through LaunchServices; direct reads from a launchd
process may fail to trigger downloads. Daemon mode instead calls a configured
host helper, defaulting to `http://127.0.0.1:5009/warmup` natively or
`http://host.docker.internal:5009/warmup` from Docker. That helper must actually
be provisioned for the selected setup; port 5009 is not a general startup
requirement or proof that arbitrary cloud hydration works.

Only the OneDrive adapter opts into restarting the OneDrive client after a
failed `open` attempt. `ONEDRIVE_AUTO_RESTART=0` disables that action; its
default cooldown is 300 seconds. Treat client restarts and host helper
provisioning as separate operational changes. Do not apply OneDrive recovery
instructions to other providers.

## Optional macOS host provisioning

The 15 historical host-runtime scripts (installers, watchdogs and host tools),
plus the obsolete `run_brain.sh` and `run_prod.sh` launchers, have been retired
from the public repository. Host operations belong in private `WorkspaceTools`.
Run `pnpm check:runtime` after staging reviewed changes: CI rejects retired
runtime sources, symbolic links and local state in the Git index.
Existing installations may write logs under
`~/Library/Logs/Gnosi`; inspect their actual configuration. These are optional
host conveniences, not the portable startup contract. Machine-specific service
definitions, private paths and incident history belong in private
`WorkspaceTools`, not in public prerequisites.

This checkout cleanup does not change, migrate or uninstall installed host services.
The portable wrappers above do not install or remove existing host services.
The historical `install_native_startup.sh` terminates listeners on 5002/5173
and reloads LaunchAgents. Do not run preserved installers or watchdogs as
diagnostics; review the actual installed configuration and private procedures.

For an installation that still uses a preserved `native_watchdog.sh`,
inspect `~/.gnosi_native_watchdog.log` for restart loops. Startup grace
(`GNOSI_NATIVE_STARTUP_GRACE`) and restart cooldown
(`GNOSI_NATIVE_WATCHDOG_COOLDOWN`) both default to 600 seconds; retain adequate
time for cold startup or reload and keep cooldown at least as long as the
measured startup requirement. A fresh clone heartbeat can defer a restart.
The script also kills matching multiprocessing workers and invokes launchd:
its process matching is broad, so do not run it as a generic diagnostic or
install it without reviewing the host's other Python workloads.

## Optional Docker deployment

Docker is a supported, optional self-hosting target. The base
`docker-compose.yml` needs no host vault directory or maintainer-specific path:

| Persistent content | Named volume | Container path |
| --- | --- | --- |
| Per-device databases and credentials | `gnosi_local_data` (preserved key) | `/data`, via `GNOSI_DATA_DIR` |
| Vaults | `gnosi_vaults` (new volume) | `/vaults`, via `GNOSI_VAULTS_ROOT`; active default `/vaults/default` |

Existing host vaults are not copied into the new volume automatically. Preserve
the existing Compose project name when upgrading: it determines named-volume
identity. Changing it can select empty volumes while old data still exists.
Back up databases, credentials and vaults before changes. Never use
`docker compose down -v` or broad volume pruning as a dependency repair.

Published ports default to `127.0.0.1:5002` and `127.0.0.1:5173`.
`GNOSI_BIND_ADDRESS`, `GNOSI_BACKEND_PORT` and `GNOSI_FRONTEND_PORT` configure
host publication; internal ports stay 5002/5173 and the frontend proxies to
`backend:5002`. Compose forces frontend HTTP. Review authentication, TLS and
network access before changing the bind address to expose the service.

Supply a strong private `GNOSI_JWT_SECRET` through the shell or local `.env`
for Compose interpolation. A service `env_file` alone cannot satisfy the
required expression. Compose explicitly sets `GNOSI_REQUIRE_AUTH=1`;
do not disable authentication to obtain a passing smoke test.

Compose reads an optional shared `env_file` selected by
`GNOSI_SHARED_ENV_FILE` (fallback `.env.shared.disabled`), then optional `.env`;
the latter wins for duplicate keys. Explicit service `environment` entries win
over both files. These are container environment rules: arbitrary host shell
variables are not automatically forwarded. Compose reads the files on the host,
without mounting or baking them into images, and clears `GNOSI_SHARED_ENV_FILE`
inside the backend to avoid reloading a host path. No parent `.env_shared` is
implicitly required.

The bundle includes Zotero's translation-server internally on 1969, without a
published host port. `GNOSI_TRANSLATION_IMAGE` selects its image;
`TRANSLATION_SERVER_URL` defaults to `http://translation-server:1969` only when
unset and preserves an explicit empty value. Translation is optional to Gnosi,
but this Compose file declares the sidecar without an optional profile.

To use existing host directories, explicitly add `compose.vaults.yml`:

```sh
docker compose -f docker-compose.yml -f compose.vaults.yml up -d --build
```

Before that command, supply both `VAULT_HOST_PATH` (existing active vault) and
`VAULTS_ROOT_HOST_PATH` (existing parent directory) to Compose interpolation.
Both are required; both bind mounts use `create_host_path: false` to reject
missing directories. Prefer absolute paths; relative paths resolve from the
base Compose file's directory. The override replaces the `/vaults` volume by
container target, adds the active bind at `/vault`, and sets
`DIGITAL_BRAIN_VAULT_PATH=/vault`. It preserves `gnosi_local_data:/data` and
forwards the two selected host paths for file-action translation. This does
not copy data or provision host helpers.

The base bundle mounts no source code, host dependencies, home directory,
private `.antigravity` tree, secrets directory or Docker socket. The explicit
vault override adds only its two selected directories. The backend image's
Docker CLI does not grant host-engine access without a socket or separately
configured endpoint. Code and dependencies belong to the images: there is no
host-source hot reload or anonymous `node_modules` volume to renew. Rebuild
images after source or lock changes; preserve persistent volumes.

`Dockerfile.frontend` uses Node 22.22.2, pnpm 11.19.0 and
`--frozen-lockfile`, then serves Vite on strict port 5173. The backend exports
`uv.lock` with `--frozen`, installs the pinned CPU-only Torch wheel and then
the exported requirements; uvicorn runs without `--reload`. Wheel availability,
image builds and startup require platform-specific validation. Static
source/contract tests do not replace actual Compose merging, engine builds,
container smoke tests or platform acceptance.

## Authenticated acceptance and QA boundaries

Native acceptance must exercise real registration, workspace and first-vault
creation, login, `/api/auth/me`, HttpOnly cookies and Playwright authentication
setup, with clean startup and shutdown. Browser checks must create and edit a
disposable page, reload and reopen it to verify title/body persistence, inspect
the console and verify logout. Even a passing fixture and browser flow do not
certify the full E2E suite, Docker/Electron matrix or release readiness.

E2E setup requires explicit `GNOSI_TEST_EMAIL` and `GNOSI_TEST_PASSWORD` for
an already provisioned disposable account before networking. It logs in and
verifies the session through `/api/auth/me`; it does not register accounts or
invent an admin identity. `GNOSI_TEST_WORKSPACE_ID` must match a verified
membership; omit it only when exactly one membership exists.
`GNOSI_TEST_VAULT_ID` is optional and grants no permissions. Keep session state
private, preferably at a temporary `GNOSI_TEST_STORAGE_STATE`, and do not enable
credential-bearing setup traces, screenshots, video or diagnostic logging.

`backend/tests/test_vault_creation_membership.py` covers first-vault creation
with authenticated owner/admin/editor membership, rejects unauthenticated,
read-only and cross-workspace callers, and checks path confinement and
organization listing without personal-vault registration. This regression
coverage does not replace real application/browser validation. The integration
owner retains the full browser, CI, SOP and platform acceptance gates.

From the repository root, `corepack pnpm test:e2e:contracts` runs offline
authentication, JSON and API-route contracts, then strictly type-checks all
active E2E TypeScript specs and support files, including feature, anonymous,
accessibility and visual tests. The focused `typecheck:auth` alias remains
available. It does not start the application or replace real login/browser
acceptance; archived JavaScript specs are outside this check.

## Optional Electron packaging

Electron uses inherited `GNOSI_DATA_DIR`, then `GNOSI_LOCAL_DATA`, then
`LOCAL_DATA_DIR`; otherwise it passes its `userData` profile to the bundled
backend. Do not assume this profile is identical to the native Python default
on every OS. Preserve the profile as well as any separately configured backend
data before an update.

The workspace pins Electron and disables its automatic binary download.
`corepack pnpm --filter @gnosi/desktop install:runtime` is the explicit binary
installation step when running Electron locally. Build the frontend before
packaging. `desktop/build-python.sh` requires Python 3.11 and uv, creates a
temporary environment and uses `uv sync --frozen --no-default-groups --group desktop`
against the repository lock. It checks resource boundaries, runs PyInstaller,
verifies the bundle and runs the packaged-backend smoke test. There is no
current pip 25.3 pin; diagnose proxy or package-index errors on the affected
runner instead of reviving that historical workaround.

| Target declared by the release workflow | Configured artifacts |
| --- | --- |
| macOS arm64 | DMG and ZIP |
| macOS x64 | DMG and ZIP |
| Linux arm64 | AppImage and DEB |
| Windows x64 | NSIS installer |

These are configured targets, not acceptance results. The frozen Python backend
must match the Electron target architecture. Linux x64 and Windows arm64 are
not covered by the current release jobs. Static contracts or a frontend build
do not establish clean installation, first launch, update, rollback, signing or
real data preservation on any target. Require actual platform evidence before
publishing; Docker validation is a separate check.

## Common symptom map

| Symptom | Likely area | Next evidence |
| --- | --- | --- |
| Blank frontend | JavaScript error, stale chunk, auth bootstrap | Browser console, Vite log, production build. |
| Health responds, vault fails | Vault path, permissions, file availability | Authorized config, vault logs, exact failing path. |
| Settings revert | Wrong params target, failed write, migration | Active vault context and params source. |
| Integration appears disconnected | Local credential missing or stale account selection | Masked account state and configured secret storage. |
| Agent has no tools | MCP connection, catalog validation, skill assignment | Discovery logs and authorized skill endpoints. |
| Mail stops updating | Account worker or provider authentication | Per-account worker state and incremental sync. |
| Desktop shows an old version | Stale renderer/backend or mismatched manifests | Actual running checkout/bundle and package versions. |

## Documentation and incident learning

Use the documentation pre-PR workflow in
[Documentation maintenance](../testing/documentation-maintenance.md).
Review all four languages manually; refresh only generated catalogs
deterministically. The integration owner runs pre-PR checks, strict builds for
all four portals and browser QA after workers finish. Keep `site/engineering`
and its locale subdirectories out of source control.

The Pages workflow is configured to publish documentation changes on `main`
to [the engineering portal](https://gnosi.temenosismael.org/engineering/).
On failure, inspect generated-reference validation, traceability and strict
locale builds before the Pages artifact. Check the repository's actual Pages
source and `github-pages` environment permissions; workflow source alone does
not prove deployment succeeded.

Record incident causes, failed attempts and verified recovery. Keep private
machine details and development directives in `WorkspaceTools`; publish only
portable lessons with source and test evidence. Fix implementation and add
focused regression coverage when warranted. A terminal-only recovery without
verification or documentation does not complete an operational repair.

# Gnosi changelog

## Gnosi 3.0.0

_2026-09-02 · Release candidate_

### Highlights

- Gnosi 3.0 establishes one canonical repository with a modular FastAPI backend and a feature-oriented React 19 interface.
- The complete production interface uses strict TypeScript and deterministic OpenAPI contracts through a shared data layer.

### Improvements

- Canonical, provider-neutral data directories and verified 2.x migrations keep local Vaults recoverable across native, Docker and desktop installations.
- Electron 43 provides isolated IPC, owned backend startup and architecture-specific packages for macOS, Windows and Linux.

### Fixes

- Node 22.22.2 and the pnpm and uv locks remove duplicate dependency graphs and make local releases reproducible.
- Release gates validate source identity, generated clients, documentation, migrations and architecture-separated installers before publication.
- Windows packaging now allows a bounded cold resource verification to finish without weakening the fail-closed package policy.
- The macOS Intel package pins the NumPy ABI compatible with its Torch runtime.

## Gnosi 3.0.0-rc.2

_2026-09-01 · Release candidate_

### Fixes

- The frozen Python graph now selects compatible wheels for every supported macOS, Linux and Windows desktop architecture.
- Desktop packaging now accepts third-party namespace metadata while continuing to reject unreviewed Gnosi-owned resources.

## Gnosi 3.0.0-rc.1

_2026-09-01 · Release candidate_

### Highlights

- Gnosi now has one canonical repository with a modular FastAPI backend and a feature-oriented React interface.
- The complete production interface is TypeScript-based and uses generated OpenAPI contracts for safer server data access.

### Improvements

- Portable data directories, explicit shared-environment configuration and verified migrations keep local Vaults recoverable across native, Docker and desktop installations.
- Electron 43 adds an isolated IPC contract, owned backend startup and architecture-specific packaging for macOS, Linux and Windows.

### Fixes

- Node 22.22.2, pnpm and uv now provide frozen, reproducible dependency graphs without duplicated npm or Python environments.
- Release validation now checks source identity, documentation, generated clients, installers and architecture-separated artifacts before publication.

## Gnosi 2.0.6

_2026-08-26 · Stable_

### Highlights

- Browser navigation and API routes now respect the active Vault, keeping each context isolated.

### Improvements

- Contextual focus indicators once again make the active element clear.

### Fixes

- Windows packaging isolates its Python environment and enables long paths to avoid conflicts with other processes.
- Contextual tooltips close correctly when menus open, and view drafts can be cancelled without stale state.

## Gnosi 2.0.5

_2026-08-25 · Stable_

### Improvements

- Release tags are now checked against the packaged version, localized notes and changelog before any platform build starts.

### Fixes

- Updated desktop and backend dependencies improve compatibility and release reliability across macOS, Windows and Linux.

## Gnosi 2.0.1

_2026-08-24 · Stable_

### Fixes

- Desktop packages now include the XML safety dependency required by the academic literature connector.
- Release tags now use the configured local runners, avoiding hosted Actions budget limits.

## Gnosi 2.0.0

_2026-08-24 · Stable_

### Highlights

- Grounded Notebooks let you build a conversation from the attachment and URL fields of selected Resources, with answers supported by navigable evidence citations.

### Improvements

- Choose the exact sources or complete linked notebooks to include in each conversation, and organize Resource sources into groups.
- Dialogs now respond to Escape and the shared interface adds automated accessibility coverage.

### Fixes

- Notebook conversations now keep their read-only source tools isolated and report their available tools accurately.

## Gnosi 1.0.7

_2026-08-19 · Stable_

### Improvements

- Secondary capabilities now activate per Vault as built-in plugins. Existing Vaults migrate to core-only mode without losing data or settings; sharing, mail sync, publishing and user automations stay paused until reactivated.

### Fixes

- Fixed Gallery database view rendering when displaying authorship properties.

## Gnosi 1.0.6

_2026-08-19 · Stable_

### Fixes

- Fixed local data directory fallbacks and release version synchronization across desktop packaging manifests.

## Gnosi 1.0.5

_2026-08-16 · Stable_

### Fixes

- macOS Intel builds now include the cryptography wheel compatible with this architecture.
- Packaged applications pin the backend Python runtime so they start consistently after installation.

## Gnosi 1.0.4

_2026-08-15 · Stable_

### Fixes

- Desktop packages once again include the native-menu module, so the application starts correctly after installation.
- The packaged application starts its complete bundled backend from the correct executable path and stores runtime data in the user’s writable application folder.

## Gnosi 1.0.3

_2026-08-15 · Stable_

### Improvements

- The native desktop menu now follows Gnosi’s language and includes Settings, Check for Updates and standard macOS actions.

### Fixes

- A new window can now be opened after the last Gnosi window is closed.
- Production builds no longer expose reload actions or developer tools.

## Gnosi 1.0.2

_2026-08-15 · Stable_

### Improvements

- The desktop update notice is now smaller and quieter, and it surfaces errors from user-initiated actions.

### Fixes

- On macOS, the update action now downloads the correct official DMG instead of offering a restart that ad-hoc signatures cannot complete.
- Release history no longer opens automatically when the application starts or before an update download.

## Gnosi 1.0.1

_2026-08-15 · Stable_

### Fixes

- The Gnosi icon now shows a centered white G with the correct blue margin in the desktop application and on the web.

## Gnosi 1.0.0

_2026-08-15 · Stable_

### Highlights

- Gnosi 1.0 brings sources, evidence notes, connected synthesis and citation handoff together in one local-first research workspace.
- Assistant responses can link supported claims to exact Vault, Reader or web sources.

### Improvements

- A multilingual Research Starter Workspace demonstrates the complete path without requiring an AI provider or external account.
- Vault inventories return complete, paginated and deduplicated results without unnecessary model calls.
- Background analyses can be refreshed, resumed or cancelled, with bounded retries and recovery after a restart.
- Response details expose the plan, privacy boundary, evidence, verification status and processing time.

### Fixes

- Vault requests no longer repeat the same tools until they time out or exhaust the recursion limit.
- Failed or incomplete requests now preserve useful diagnostics and offer clear recovery actions.

## Gnosi 1.0.0-rc.3

_2026-08-14 · Release candidate_

### Highlights

- Create Vaults from an official template repository directly in the application.
- Plugins share a repository experience with verifiable provenance information.

### Improvements

- Official indexes and packages are verified with SHA-256 and Ed25519 signatures before installation.
- Vaults and plugins can be exported as filtered packages and prepared for moderated publishing.

## Gnosi 1.0.0-rc.2

_2026-08-03 · Release candidate_

### Highlights

- Desktop applications now use the official Gnosi icon on macOS, Windows and Linux.

### Improvements

- Release builds verify the macOS signature, application icon and packaged interface before uploading installers.

### Fixes

- The macOS application bundle is fully sealed so the system no longer reports it as damaged.
- Desktop installers now include and load the complete Gnosi interface.

## Gnosi 1.0.0-rc.1

_2026-08-03 · Release candidate_

### Highlights

- Settings are organized into clearer sections and tabs.
- A new engineering documentation portal makes the system easier to understand and maintain.

### Improvements

- The knowledge graph has clearer edges, loading feedback and more focused hover relationships.
- Vault navigation and page controls are more consistent and easier to identify.

### Fixes

- Several visual inconsistencies in Settings have been corrected.
- Expanded and selected interface states are preserved more reliably.

## Gnosi 0.3.0-rc.1

_2026-08-01 · Release candidate_

### Highlights

- First release candidate with desktop packages for macOS, Windows and Linux.

### Improvements

- Desktop update detection and installation foundations are included.
- Official plugin packages and their distribution index are included with releases.

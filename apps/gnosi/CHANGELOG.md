# Gnosi changelog

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

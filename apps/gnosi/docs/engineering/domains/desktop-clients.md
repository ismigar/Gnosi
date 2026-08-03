---
status: implemented
last_verified: 2026-08-02
source_paths:
  - electron/main.js
  - electron/preload.js
  - electron/electron-builder.yml
  - electron/release.sh
  - web-clipper
  - integrations/libreoffice-cite
  - integrations/word-cite-pin
tests:
  - integrations/libreoffice-cite/tests
---

# Desktop and companion clients

## Electron desktop

Electron packages Gnosi as a desktop application. The main process owns backend
startup, process cleanup, window lifecycle, packaged-resource paths, update
checks, downloads, installation, and privileged desktop actions. The renderer
receives a narrow preload API rather than direct Node.js access.

The bundled Python backend must be ready before the renderer treats the app as
usable. Startup failures are surfaced with diagnostics and cleanup prevents
orphaned backend processes after the window exits.

## Update state machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Checking: renderer ready
    Checking --> Available
    Checking --> Current
    Checking --> Error
    Available --> Downloading: user confirms download
    Downloading --> Ready
    Downloading --> Error
    Ready --> Installing: user confirms restart
```

Checks are disabled in development. Downloads never begin merely because a
release exists. The main process stores the latest updater state so a renderer
that subscribes late can recover it through IPC.

Release artifacts include installers and updater metadata for macOS, Windows,
and Linux. Version preparation keeps frontend and Electron manifests aligned;
tags are created only from reviewed `main` commits.

## Web clipper

The browser extension extracts the current page's title, URL, selected or
readable content, and supported metadata, then sends a bounded request to the
Gnosi API. The backend performs authentication, sanitization, deduplication,
and Vault writes. The extension does not receive arbitrary Vault filesystem
access.

## LibreOffice and Word citation clients

The LibreOffice extension registers a protocol handler and calls Gnosi's
citation endpoints from the office process. The Word helper maintains the
task-pane/add-in state required to access the same local service. Both clients
treat citation insertion and bibliography refresh as explicit document
mutations.

Office-specific APIs are isolated behind traversal and insertion helpers so
tests can fake the UNO or add-in boundary without requiring the full office
application for every unit test.

## Invariants

- Renderer code has no unrestricted Node.js or filesystem capability.
- IPC exposes named operations with validated inputs.
- Update download and installation require explicit user actions.
- Packaged resource paths differ from development paths and are resolved at
  runtime.
- Companion clients authenticate to the backend and remain within their narrow
  capture or citation scope.
- Release drafts are inspected before publication.

## Verification focus

Run Electron syntax/build checks, packaged backend smoke tests, updater state
tests, extension build validation, citation traversal tests, and platform CI.
Local macOS packaging cannot prove Windows or Linux artifacts.

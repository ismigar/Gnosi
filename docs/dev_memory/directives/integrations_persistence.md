# Directive: Integration persistence

## Problem

Adding Google accounts could lose data because frontend autosave raced the
backend OAuth callback. The browser overwrote newly stored server
configuration with stale local state.

## Mandatory rules

### Block autosave until initial load

Every integration settings component must keep an initial-load guard such as
`integrationsLoadedRef`. Enable it only after the first successful
`GET /api/integrations`. Abort every save while the guard is false so empty
local defaults cannot replace server data.

### Stable identifiers

Use `google_{email}` consistently across `mail_accounts`, `calendars`, and
`contacts`. Stable IDs allow a correct deep merge.

### Merge rather than replace

`IntegrationManager` should use `bulk_update` to merge by ID. Update an
existing item or append a new one; do not replace complete lists unless the
operation explicitly requires replacement.

### Runtime diagnostics

Native FastAPI on port 5002 is the default development runtime. Inspect
`~/Library/Logs/Gnosi/backend-native.log` and `.err` first. Docker deployments
remain supported and use their container logs. Do not mix Flask and FastAPI
routes, and keep the frontend proxy pointed to the configured backend port.

Created after the Gmail persistence incident on 2026-04-22.

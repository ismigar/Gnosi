---
name: calendar-sync
description: Maintain Gnosi's calendar aggregation and dated-vault integration without reviving legacy sync scripts. Use for calendar loading, provider routing and synchronization regressions.
---

# SKILL: Calendar Sync

This skill manages the synchronization between the Vault data engine and the Calendar interface.

> ID: CAL-SYNC-20260408 <!-- @language-example: stable identifier -->
> Status: ACTIVE

---

## 1. Current architecture

`backend/api/calendar_routes.py` owns the hybrid calendar API. `GET
/api/calendar/events` aggregates configured Google/CalDAV events and, when
requested, dated vault notes. The existing `POST /api/calendar/sync` is a
compatibility no-op; a successful response does not mean files were imported.
Inspect the provider adapter before promising write support for a provider.

The old standalone ICS-to-Markdown script was retired after consumer review and
private historical preservation. Do not restore it as a development startup or
maintenance job: it deleted local event files before fetching replacements and
used obsolete credential paths. Existing vault event files are not removed by
the source cleanup. Never run a real sync to validate a documentation change.

## 2. Dated vault pages

For consumers that request dated pages directly:

- **Endpoint**: `GET /api/vault/pages?only_calendar=true`
- **Behavior**: The backend filters the results to only return pages with `date` metadata or those belonging to tables with calendar functionality enabled.

---

## 3. Performance Optimization (Technical Protocol)
In large vaults, searching for files can be slow. The following architectural rules must be applied:

1. **Pre-calculation**: Do not index or sort folders within the main page processing loop. Do it once at the start of the request.
2. **Server-side Filtering**: Use the calendar events API for the hybrid view. When requesting vault pages directly, use `only_calendar=true`; do not fetch every page and filter in the browser.
3. **Context and cache**: Preserve the active-vault context and existing cache invalidation. Do not introduce per-event filesystem scans or change API payloads while refactoring.

---

## 4. Verification and learning

Use synthetic provider responses and a disposable vault. Verify Google/CalDAV
routing, dated-note inclusion, hidden events and the compatibility no-op without
calling real accounts. Run the relevant backend tests, type checks and the
calendar UI flow before claiming a functional change complete.

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-04-07 | Axios Timeout (30s) | O(N*M log M) complexity in backend | Refactored `vault_routes.py` to pre-sort folders and added server-side filtering. |
| 2026-04-08 | Lack of Documentation | Fragmented memory in `docs/` | Created official `SKILL.md` integrating the timeout fix learnings. |
| 2026-09-03 | The calendar looked empty while 21 external events were still loading; compact mode also highlighted Day while FullCalendar opened Month | External events used an imperative request with no visible pending/error state, and the page did not pass its selected initial view to the calendar | Route external data through TanStack Query with cancellation/cache reuse, retain previous verified events during refetch, expose loading/error/retry state, and pass the controller's initial view. Note: do not validate query-driven rendering with fixed sleeps or one long enclosing `act`; poll the observable state between short completed `act` cycles because an extra React commit is legitimate. Do not import a test helper unless the frontend manifest actually declares it. |
| 2026-09-03 | A cold real month request took about 42 seconds even though it eventually returned all events | Accounts and every Google calendar were queried sequentially, multiplying provider latency | Fetch independent accounts with a small bounded worker pool and use Google Calendar's batch transport for multiple calendars, retaining a sequential compatibility fallback. Keep cache writes in the coordinating thread, cache valid empty results, isolate provider failures, and prove concurrency/batching with synthetic providers before a read-only real timing check. |
| 2026-09-03 | The first implementation of bounded account loading pushed `calendar_routes.py` above the 800-line guardrail | Concurrency orchestration was added inside an already large route module | Keep the route responsible for HTTP composition and cache policy, but place provider-neutral bounded loading in `services/calendar_event_aggregation.py`. Do not waive or baseline a new size violation when a cohesive extraction is available. |

---
*Maintenance: If the Calendar starts being slow again, verify the caching mechanism of the `_get_pages_snapshot` function in the backend.*

# SKILL: Calendar Sync

This skill manages the synchronization between the Vault data engine and the Calendar interface.

> ID: CAL-SYNC-20260408 <!-- @language-example: stable identifier -->
> Status: ACTIVE

---

## 1. API Operation
The Calendar App requires fast and efficient loading of pages with associated dates.

- **Endpoint**: `GET /api/vault/pages?only_calendar=true`
- **Behavior**: The backend filters the results to only return pages with `date` metadata or those belonging to tables with calendar functionality enabled.

---

## 2. Performance Optimization (Technical Protocol)
In large vaults, searching for files can be slow. The following architectural rules must be applied:

1. **Pre-calculation**: Do not index or sort folders within the main page processing loop. Do it once at the start of the request.
2. **Server-side Filtering**: Never request "all pages" from the frontend to filter in the calendar; always use the `only_calendar=true` flag.

---

## 3. History and Learning (Learning Cycle)

| Date | Error / Learning | Root Cause | Solution / Refinement |
| --- | --- | --- | --- |
| 2026-04-07 | Axios Timeout (30s) | O(N*M log M) complexity in backend | Refactored `vault_routes.py` to pre-sort folders and added server-side filtering. |
| 2026-04-08 | Lack of Documentation | Fragmented memory in `docs/` | Created official `SKILL.md` integrating the timeout fix learnings. |

---
*Maintenance: If the Calendar starts being slow again, verify the caching mechanism of the `_get_pages_snapshot` function in the backend.*

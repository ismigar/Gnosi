# DIRECTIVE: FIX_CALENDAR_API_TIMEOUT

> ID: 20260407-01
Associated Script: None (Backend/Frontend Fix) Last Update: 2026-04-07
Status: DRAFT

---

## 1. Objectives and Scope

The `/api/vault/pages` endpoint is timing out (30s) when called from the `CalendarPage.jsx`. This is due to inefficient backend processing and the frontend requesting all pages and filtering them locally.

- **Main Objective:** Reduce the response time of the `/api/vault/pages` request and optimize the calendar data flow.
- **Success Criteria:** The calendar loads in under 5 seconds without timing out.

## 2. Input/Output (I/O) Specifications

### Inputs
- **API Request:** `GET /api/vault/pages?only_calendar=true` (New parameter).

### Outputs
- **API Response:** JSON list of `PageInfo` objects, filtered by calendar relevance.

## 3. Logical Flow (Algorithm)

1. **Backend Optimization:**
    - In `vault_routes.py`, refactor `_get_pages_snapshot` to pre-calculate the sorted list of table folders once, instead of sorting them inside the loop for every page.
    - Update `_get_pages_snapshot` to accept a `filter_calendar` boolean.
    - Implement a filtering logic in the backend that only returns pages with `date` metadata or belonging to enabled calendar tables.

2. **Frontend Update:**
    - Update `CalendarPage.jsx` to call `/api/vault/pages?only_calendar=true`.
    - Adjust the frontend filtering logic to rely on the backend's pre-filtered data.

## 5. Restrictions and Edge Cases

- **Large Vaults:** Even with optimization, `rglob` can be slow. The cache mechanism should be verified.
- **Enabled Tables:** The "only calendar" filter must respect the `enabled_tables` defined in integrations.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 07/04 | AxiosError: timeout 30000ms | O(N*M log M) sort inside loop in `_get_pages_snapshot`. | Move sort out of loop and add server-side filtering. |

---

## 8. Pre-Execution Checklist

- [ ]  Identify the exact lines to refactor in `vault_routes.py`.
- [ ]  Test the optimized function with a large synthetic dataset if possible.
- [ ]  Verify frontend parameter passing.

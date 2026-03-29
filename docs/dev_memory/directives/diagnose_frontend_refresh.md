# Directive: Fix Aggressive Frontend Refresh

> ID: diagnose_frontend_refresh
> Associated Script: N/A (Manual/React Fix)
> Last Update: 2026-01-19
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Identify and fix the cause of the aggressive page refresh/reload in the frontend `GraphPage`.
- **Success Criteria:** The application updates data without destroying the UI state or showing a full-screen loading spinner repeatedly, and does not refresh more often than intended (e.g., background sync only).

## 2. Input/Output (I/O) Specifications

### Inputs
- **Source Files:** `monorepo/apps/digital-brain/frontend/src/pages/GraphPage.jsx`

### Outputs
- **Modified Source:** Optimized `GraphPage.jsx` handling loading states and sync intervals.

## 3. Logical Flow (Diagnosis & Fix)

1. **Identify Triggers:** Check `useEffect` hooks and intervals.
   - *Findings:* A `setInterval` triggers `/api/sync` every 30s, which calls `fetchGraphData`.
   - *Findings:* `fetchGraphData` sets `loading(true)`, which triggers a full component tree unmount/remount (switching from `<Layout>` to `<div>Loading...</div>`).
2. **Fix Loading State:**
   - Determine if `loading` should be global.
   - Use a separate `isBackgroundUpdating` or similar state for periodic updates, or simply do not set `loading(true)` if data is already present.
3. **Verify Re-mounts:** Ensure `GraphPage` itself isn't unmounting due to parent route changes.

## 4. Tools and Libraries
- React DevTools (conceptually)
- Code Analysis

## 5. Restrictions and Edge Cases
- **UX:** Do not block user interaction during background sync.
- **Race Conditions:** Handle `fetch` responses arriving out of order if applicable (though less critical for simple polling).
- **Error Handling:** Ensure failed syncs don't crash the app.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 19/01 | Aggressive UI Reset | `fetchGraphData` setting `loading=true` causes full re-render of `Layout` | Only set `loading=true` on initial load. |
| 19/01 | Fix Failed (Still Refreshing) | Stale closure in `useEffect([])` meant `graphData` was always null inside the interval. | Use an explicit argument `isBackground` instead of relying on state captured in closure. |
| 19/01 | Freezing / Aggressive Refresh | Massive `Minimap Sync` log flood (~30k/30s) indicating an infinite loop. Also `GraphViewer` re-inits on every data update. | Fix Minimap loop and refactor `GraphViewer` to merge data instead of re-init. |
| 19/01 | Empty Graph / 500 Errors | Backend process hanging at startup while connecting to `notion-mcp`, causing connection resets. | Added `asyncio.wait_for` timeout to MCP initialization to fail fast and allow API boot. |

## 7. Examples of Use

N/A (React Component Logic)

## 8. Pre-Execution Checklist
- [x] Analyze `GraphPage.jsx`

## 9. Post-Execution Checklist
- [ ] Verify UI stays stable during sync

# DIRECTIVE: vault_feed_view

> ID: vault_feed_view
Last Update: 2026-02-25
Status: ACTIVE
> 

---

## 1. Objectives and Scope

*Describe here WHAT this task should achieve and WHY.*

- **Main Objective:** Implement the "Feed" view type for the 4-layer database architecture in the Vault.
- **Success Criteria:** Users can select "Feed" as a view type for a Table, and see their records displayed in a single-column (or max 2-column on very wide screens) feed format, similar to a social media feed or blog roll.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Frontend Action:** User clicks "+" to add a view and selects "Feed".
- **Data Source:** `tableNotes` (records belonging to the active table) and `schema` (to format properties).

### Outputs
- **UI:** A vertical feed layout (`VaultFeed.jsx`).
- **Data Display:**
  - Cards should span a significant width (e.g., max-w-2xl).
  - Prominent cover image (if available).
  - Title and metadata properties.

## 3. Logical Flow (Algorithm)

1. **Enable Option:** In `VaultViewsTabs.jsx`, enable the 'feed' option in the "Add View" dropdown.
2. **Component Creation:** Create `VaultFeed.jsx`.
   - Take `notes`, `schema`, `idToTitle`, and `onNoteSelect` as props.
   - Sort notes by `last_modified` descending (newest first) to mimic a real feed.
   - Map over notes and render large, full-width cards.
   - The card top is a large cover image (e.g., `h-48` or `h-64`).
   - The card bottom contains the icon, title, date, and properties.
3. **Dashboard Integration:** In `VaultDashboard.jsx`, check if `cv.type === 'feed'` and render `<VaultFeed />`.

## 4. Tools and Libraries

- **Frontend:** React, Tailwind CSS.

## 5. Restrictions and Edge Cases

- **Missing Content/Excerpt:** The `GET /api/vault/pages` endpoint doesn't return the markdown body for performance reasons. Therefore, the feed will focus on displaying the available metadata (cover, title, icon, tags) in a rich, expansive format without requiring N additional API calls for the body.
- **Responsiveness:** Single column centered layout usually works best for a feed.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| | | | |

## 7. Examples of Use

Select "Feed" in the views tab of any database table. Ideal for visual databases like Inspiration, Recipes, or Blog posts.

## 8. Pre-Execution Checklist

- [ ] Design feed layout in React + Tailwind.

## 9. Post-Execution Checklist

- [ ] "Feed" option is selectable.
- [ ] Notes display in a vertical, centered feed format.
- [ ] Clicking a post opens the note.

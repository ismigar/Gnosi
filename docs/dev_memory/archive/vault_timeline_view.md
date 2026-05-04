# DIRECTIVE: vault_timeline_view

> ID: vault_timeline_view
Last Update: 2026-02-25
Status: ACTIVE
> 

---

## 1. Objectives and Scope

*Describe here WHAT this task should achieve and WHY.*

- **Main Objective:** Implement the "Cronograma" (Timeline) view type for the 4-layer database architecture in the Vault.
- **Success Criteria:** Users can select "Cronograma" as a view type for a Table, and see their records displayed on a timeline. The timeline should map records based on a Date property (e.g. `created_time`, `last_edited_time`, or a custom `date` property from the schema).

## 2. Input/Output (I/O) Specifications

### Inputs
- **Frontend Action:** User clicks "+" to add a view and selects "Cronograma".
- **Data Source:** `tableNotes` (records belonging to the active table) and `schema` (to find date properties).

### Outputs
- **UI:** A timeline layout (`VaultTimeline.jsx`).
- **Data Mapping:**
  - Find the best "date" property to sort the items: 
    1. Check if there's any property of type `date`.
    2. Otherwise, fallback to `last_modified` (or `last_edited_time`).
  - Sort items chronologically.
  - Render a vertical or horizontal timeline showing the items as nodes or cards along the axis. A vertical timeline is usually easier to read and responsive.

## 3. Logical Flow (Algorithm)

1. **Enable Option:** In `VaultViewsTabs.jsx`, enable the 'timeline' option in the "Add View" dropdown.
2. **Component Creation:** Create `VaultTimeline.jsx`.
   - Take `notes`, `schema`, `idToTitle`, and `onNoteSelect` as props.
   - Determine which date property to use for sorting. For a robust timeline, default to sorting by `last_modified` descending, unless the schema explicitly defines a `date` field. Let's group items by Month/Year to make the timeline visually structured.
   - Render a vertical axis (e.g., a line down the left side or center).
   - Render each note as an entry attached to the axis, showing its date, title, and a few properties, plus the cover if it has one.
3. **Dashboard Integration:** In `VaultDashboard.jsx`, check if `cv.type === 'timeline'` and render `<VaultTimeline />`.

## 4. Tools and Libraries

- **Frontend:** React, Tailwind CSS (for the line and relative positioning), Lucide Icons.

## 5. Restrictions and Edge Cases

- **Missing Dates:** All notes have at least `last_modified`, so we always have a fallback.
- **Responsiveness:** A vertical timeline is naturally responsive, just make the content boxes stretch to fill the remaining width.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| | | | |

## 7. Examples of Use

Select "Cronograma" in the views tab of any database table. Useful for project roadmaps or chronological history.

## 8. Pre-Execution Checklist

- [ ] Design timeline layout in React + Tailwind.

## 9. Post-Execution Checklist

- [ ] "Cronograma" option is selectable.
- [ ] Notes display in chronological order along an axis.
- [ ] Clicking an entry opens the note.

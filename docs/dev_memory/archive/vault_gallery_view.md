# DIRECTIVE: vault_gallery_view

> ID: vault_gallery_view
Last Update: 2026-02-25
Status: ACTIVE
> 

---

## 1. Objectives and Scope

*Describe here WHAT this task should achieve and WHY.*

- **Main Objective:** Implement the "Gallery" view type for the 4-layer database architecture in the Vault.
- **Success Criteria:** Users can select "Galeria" as a view type for a Table, and see their records displayed as cards. Cards should show the cover image (if available) and select properties based on the view configuration.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Frontend Action:** User clicks "+" to add a view and selects "Galeria".
- **Data Source:** `tableNotes` (records belonging to the active table), `schema` (to format properties), and `globalIndex` (for relations).

### Outputs
- **UI:** A grid of cards (`VaultGallery.jsx`).
- **Card Content:** 
  - Image (`metadata.cover` or fallback generic pattern/color).
  - Title (`note.title`).
  - 1-3 configured properties (for now, maybe just show all or none by default to keep it simple, or `last_modified`).

## 3. Logical Flow (Algorithm)

1. **Enable Option:** In `VaultViewsTabs.jsx`, enable the 'gallery' option in the "Add View" dropdown.
2. **Component Creation:** Create `VaultGallery.jsx`.
   - Take `notes`, `schema`, `idToTitle`, and `onNoteSelect` as props.
   - Render a CSS Grid or Flex wrap container.
   - For each note, render a card.
   - The card top half is an image (using `metadata.cover` if present).
   - The card bottom half contains the title and maybe a couple of small property pills (e.g., status, tags).
3. **Dashboard Integration:** In `VaultDashboard.jsx`, check if `cv.type === 'gallery'` and render `<VaultGallery />`.

## 4. Tools and Libraries

- **Frontend:** React, Tailwind CSS (for grid/flex layouts), Lucide Icons.

## 5. Restrictions and Edge Cases

- **Missing Covers:** Notes without covers need a decent placeholder (e.g., a colored div with the icon, or a generic placeholder). Since we have `metadata.icon`, we can center the icon in a colored background as the "cover" fallback.
- **Responsiveness:** The grid should be responsive (1 column on mobile, 2 on tablet, 3-4 on desktop).

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| | | | |

## 7. Examples of Use

Select "Galeria" in the views tab of any database table.

## 8. Pre-Execution Checklist

- [x] Check existing `VaultViewsTabs` configuration.
- [ ] Design card layout in React + Tailwind.

## 9. Post-Execution Checklist

- [ ] "Galeria" option is selectable.
- [ ] Notes display as cards.
- [ ] Cover images and icons render correctly.
- [ ] Clicking a card opens the note.

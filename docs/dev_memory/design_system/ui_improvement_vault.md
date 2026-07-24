# Vault UI Improvement

## Objective

Simplify the Vault workspace, improve search placement, and present saved views
as one coherent horizontal control.

## Layout

- Remove the redundant small title below document tabs.
- Remove unnecessary borders and spacing between the active tab and workspace.
- Place search on the right side of the toolbar.
- Use a search-icon button that expands its input toward the left.
- Present Table, Gallery, and other views as horizontal tabs.
- Keep a visible add-view action.

## Implementation

- Track expanded search state explicitly.
- Place search near sort and filter controls.
- Let the expanded input consume available leftward space.
- Integrate `VaultViewsTabs` into the table/view header.
- Preserve search state during compatible view changes or close it cleanly.
- Keep the toolbar responsive on narrow screens.
- Route all visible labels through i18n with English defaults.

## QA

Verify spacing, responsive search expansion, view switching, add-view action,
keyboard accessibility, and behavior in every supported theme.

# Directive: View Settings Relocation

## Goal
Relocate view-specific settings ("Aparença", "Visibilitat", "Filtres", "Ordenació") from the global "Configuració" menu in `VaultViewHeader` to the individual `ViewTab` context menu.

## Background
The current UI has a general configuration bar that applies to the active view. The user wants these settings to be more contextual, living within each view's tab menu, to emphasize that they affect only that specific view.

## Logic/SOP
1.  **Contextual Actions**: Every view tab should have a "More" (three dots) menu or a context menu containing:
    - Reanomenar (Existing)
    - Eliminar (Existing)
    - --- (Separator)
    - Aparença (Calls `onEditViewConfig` with 'layout')
    - Visibilitat (Calls `onEditViewConfig` with 'properties')
    - Ordenació (Calls `onEditViewConfig` with 'sorts')
    - Filtres (Calls `onEditViewConfig` with 'filters')
2.  **Prop Drilling**:
    - `VaultHeaderComponents.jsx`: Update `ViewTab` to accept `onEditViewConfig` and the view object itself (or its properties).
    - `VaultViewHeader.jsx`: Pass `onEditViewConfig` to `ViewTab`.
3.  **UI Cleanup**:
    - Remove the redundant buttons from the `showConfig` bar in `VaultViewHeader.jsx`.
    - If the `showConfig` bar only contained those 4 items, consider removing the bar and the "Configuració" button entirely, or keep it if "Propietats" (Schema) still needs a home.
4.  **Verification**:
    - Ensure that clicking "Aparença" on Tab A opens the configuration for View A even if Tab B is active (or verify if the system requires Tab A to be active first). *Note: The requirement is that it affects that view.*

## Restrictions/Edge Cases
- **Active View Dependency**: Check if `ViewConfigModal` works correctly for non-active views. If it relies on the global "active view" state, we might need to select the view before opening the modal.
- **Embedded vs Dashboard**: Ensure the change works both in the full dashboard and in embedded database blocks in `BlockEditor.jsx`.

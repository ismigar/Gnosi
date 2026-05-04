# Directive: Black Dark Mode Implementation

## Goal
Transition the Gnosi application's dark mode from dark grey to pure black (#000000) for a more premium, high-contrast aesthetic.

## Steps
1. Identify all primary background CSS variables in `index.css`.
2. Update `@theme` block variables to use `#000000` where applicable (e.g., `--color-background`).
3. Update `.dark` class variables to use `#000000` for:
    - `--bg-primary`
    - `--sidebar-bg`
    - `--settings-bg`
    - `--home-bg`
    - `--settings-input-bg`
4. Style the theme selection previews in `GlobalSettingsModal.jsx`:
    - `.settings-theme-preview--light` must be `#FFFFFF`.
    - `.settings-theme-preview--dark` must be `#000000`.
5. Ensure text colors and borders maintain sufficient contrast against pure black.

## Restrictions / Edge Cases
- Do not change secondary or tertiary backgrounds to pure black unless requested, as depth might be lost.
- Ensure "Glassmorphism" effects still look good over pure black.
- Verify that the sidebar and main content area are distinguishable if they both use black (check if borders are enough).

## Verification
- Visual inspection via browser tool.
- Check components like Modals (Settings), Sidebar, and Home grid.

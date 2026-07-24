# Vault Table Interface Redesign

## Objective

Create a professional, compact table header that combines title, row count,
saved views, search, and actions.

## Requirements

- Remove dead vertical space above table content.
- Use `VaultViewsHeader` as the unified control surface.
- Allow users to reorder view tabs through drag and drop.
- Show an overflow menu when tabs exceed available width.
- Expand search toward the left.
- Pass search and view configuration through `VaultDashboard` consistently.
- Place sortable items inside the correct drag-and-drop context.
- Keep all labels localized with English defaults.

## QA

Verify tab reordering and persistence, overflow behavior, search expansion,
global state propagation, keyboard operation, and narrow-screen layout.

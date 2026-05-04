# Gnosi UI Layering (Z-Index Registry)

To avoid visual collisions where one modal or overlay covers another, this document defines the standardized `z-index` stack for the Gnosi application.

## Core Principles
1. **No Hardcoded Values**: Always use CSS variables defined in `@theme` or `:root` in `index.css`.
2. **Component Isolation**: Use `relative` or `isolation: isolate` when possible to limit stacking context scope.
3. **Escalation Policy**: New components must not exceed the `z-confirm-modal` priority unless they are global notifications (Toasts).

## Standardized Stack (from index.css)

| Variable              | Value | Purpose                                           |
| :-------------------- | :---: | :------------------------------------------------ |
| `--z-sidebar`         | 50    | Local sidebar navigation inside pages.           |
| `--z-overlay`         | 1000  | Transparent background for local dropdowns.       |
| `--z-modal`           | 10000 | Primary application modals (Settings, Note Viewer).|
| `--z-modal-dropdown`  | 10050 | Dropdowns or context menus *inside* a modal.      |
| `--z-confirm-modal`   | 20000 | Destructive action confirmation (ConfirmModal).   |
| `--z-toast`           | 50000 | Global system notifications.                      |

## Verification Check
Before delivering a UI change:
- [ ] Check if the element overlaps with an existing Modal.
- [ ] Verify that `ConfirmModal` is visible on top of the new interface.
- [ ] Ensure that background `blur` effects don't bleed into the wrong layer.

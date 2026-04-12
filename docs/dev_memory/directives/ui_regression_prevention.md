# UI Regression Prevention Directive

## Objective
Maintain the stability of key user interface (UI) components of the Gnosi project, preventing global refactorings (such as theme changes or CSS migrations) from deleting critical positioning and visualization styles.

## Critical Components

### 1. Configuration Modals (Settings)
- **Pattern**: Full-screen overlay with flexible centering and background blur.
- **Critical Classes**:
    - `.settings-overlay`: `position: fixed`, `display: flex`, `justify-content: center`, `align-items: center`, `backdrop-filter: blur(4px)`.
    - `.settings-modal`: `width`, `height` (proportional), `border-radius`, `box-shadow`.
- **Risk**: When refactoring the `:root` of `index.css`, DO NOT delete these classes. If styles are moved from inline to CSS, ensure the classes are properly defined using `kebab-case`.

### 2. Sidebar (AppSidebar)
- **Dimensions**: Fixed width of `60px`.
- **Consistency**: The order of buttons must exactly match the Home Page.

### 3. Native Dialogs (FORBIDDEN)
- **Problem**: Native dialogs (`window.confirm`, `window.alert`) are unreliable, can be blocked by browsers, and do not match the application's premium aesthetic. Their failure leads to "silent" crashes in event handlers.
- **Rule**: NEVER use `window.confirm`, `window.alert`, or `window.prompt`.
- **Solution**: Use the custom `ConfirmModal.jsx` component.
- **Implementation Pattern**:
    1. Import `ConfirmModal`.
    2. Manage modal state (`isOpen`, `data`) in the parent component.
    3. Pass the action to `onConfirm`.
- **Risk**: Using `window.confirm` in an `async` handler without a `try-catch` can crash the UI state if the dialog is blocked.

## Execution Protocol
1. **Post-Change Verification**: Whenever `index.css` is edited or a new confirmation is added, you must verify it in the browser.
2. **Avoid Inline Styles**: Prefer classes in `index.css` for global positioning.
3. **Check for Existing Components**: Before implementing a basic UI feature (dialogs, buttons, toggles), verify if a custom component already exists in `frontend/src/components`.

---
*Note: This directive was updated after a recurring failure where `window.confirm` was used in the Contacts module, causing it to fail in the user's environment.*

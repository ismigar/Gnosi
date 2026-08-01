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

- **Rule**: NEVER use `window.confirm`, `window.alert`, or `window.prompt`.
- **Solution**: Use the custom `ConfirmModal.jsx` component for binary choices, or a custom state-based modal for multiple choices.
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
## Lessons Learned & Regressions
1. **Recursion Prompt**: Using `window.prompt` for recurrent event deletion was a failure. Specialized modals with explicit choice buttons are required.
2. **Brace Mismatch (Syntax Integrity)**: When editing large components like `GlobalSettingsModal.jsx` (>800 lines), always verify that the `multi_replace_file_content` chunks maintain the correct closing brace balance (`}`). A previous error left an unclosed fragment that broke the build.
3. **Control Center Focus**: Keep the initial dashboard viewport focused on actionable controls such as schedulers, history, and administration. Do not restore passive system-health or analytics summary cards above these controls; they duplicate detail views, consume the first screen, and trigger unnecessary polling.

---
*Note: This directive was updated after a recurring failure where `window.confirm` was used in the Contacts module, and `window.prompt` was erroneously introduced in the Calendar module.*

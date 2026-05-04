# DIRECTIVE: PURGE_NATIVE_DIALOGS

> ID: 2024-04-13-PURGE
> Status: ACTIVE

---

## 1. Objectives
Eliminate all instances of `window.confirm`, `window.alert`, and `window.prompt` from the Gnosi frontend to ensure UI stability and maintain a premium aesthetic.

## 2. Rationale
Native dialogs are:
- **Unreliable**: Browsers can block them.
- **Blocking**: They freeze the main thread.
- **Aesthetic Fail**: They don't match the application's design system.
- **Untestable**: Hard to automate in headless environments.

## 3. Protocol
- **Detection**: Search for `window.confirm`, `window.alert`, `window.prompt`.
- **Replacement**: 
    - Use `ConfirmModal.jsx` for binary choices.
    - Create/Use specialized modals for complex choices (e.g., recurrent event deletion).
    - Use `toast.error` or `toast.success` for alerts/notifications.
- **Verification**: Ensure each replaced dialog also handles "Cancel" state correctly without crashing the application state.

## 4. Specific Fixes (Current Session)
- **`CalendarPage.jsx`**: Replace `window.prompt` (recurrent selection) and `window.confirm`.
- **`CalendarSidebarRight.jsx`**: Replace `window.confirm`.
- **`PageHistory.jsx`**: Replace `window.confirm`.

## 5. Lessons Learned
*"Note: Using window.confirm in an async handler without a try-catch can crash the UI state if the dialog is blocked by the browser."*

---
*Updated after a protocol failure detected in session ce6003d5.*

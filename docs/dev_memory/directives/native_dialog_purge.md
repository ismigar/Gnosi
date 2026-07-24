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

*Always search both forms: `window.confirm/alert/prompt` and the unqualified
calls `confirm(...)`, `alert(...)`, and `prompt(...)`. They reference the same
global object. Counting only `window.` misses most occurrences; one audit found
10 qualified and 12 additional unqualified calls.*

*Replace `prompt` with the reusable controlled `PromptModal.jsx` component:
`isOpen`, `onClose`, and `onSubmit(value)`. It is the input counterpart of
`ConfirmModal.jsx`. Replace `alert` with `toast.error` through
`src/lib/toast`.*

*For a confirm-to-modal refactor, split synchronous
`if (!confirm()) return; …` into `handleX`, which only opens the modal through
`setConfirmTarget(payload)`, and asynchronous `doX`, which contains the
original logic and runs from `onConfirm`. Capture the payload and context in
state when opening because `doX` runs later. This is essential in editor
callbacks such as BlockEditor.*

## 6. Canonical components
- `src/components/ConfirmModal.jsx` — binary confirmations (`isDestructive`
  for dangerous actions).
- `src/components/PromptModal.jsx` — text input, replacing `window.prompt`.
- `src/lib/toast` — `toast.error` and `toast.success`, replacing
  `window.alert`.

## 7. Complete purge (2026-06-29 session)
Purged: `VaultSwitcher`, `Dashboard` (three qualified confirmations, one
unqualified confirmation, and member handling), `ContentCalendar`,
`WorkspaceMembersPanel`, `DbViewEmbed` (confirm, prompt, and alert),
`SchemaConfigModal` (prompt), `BlockEditor` (prompt), and unqualified alerts in
`SettingsModal`, `GlobalSettingsModal`, `social/Composer`, `VaultTable`, and
`ContactsPage`. Verified with a clean search and a successful `npm run build`.
`MediaCenter` and `VaultTrashView` had already been migrated.

---
*Updated after a protocol failure detected in session ce6003d5.*
*Expanded 2026-06-29: PromptModal, the unqualified-dialog lesson, and the
complete purge.*

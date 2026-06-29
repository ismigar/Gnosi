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

*"Cerca SEMPRE les dues formes: `window.confirm/alert/prompt` I les **pelades** sense prefix (`confirm(...)`, `alert(...)`, `prompt(...)`) — són el mateix objecte global. Un recompte que només busca `window.` se'n deixa la majoria (en una sessió, 10 amb `window.` vs 12 més pelades)."*

*"Per als `prompt` cal un modal d'input; usa el component reutilitzable `PromptModal.jsx` (controlat: `isOpen`/`onClose`/`onSubmit(valor)`), germà de `ConfirmModal.jsx`. Per a `alert` → `toast.error` (wrapper `src/lib/toast`)."*

*"Patró de refactor confirm→modal: el handler síncron `if(!confirm())return; …` es parteix en `handleX` (només obre: `setConfirmTarget(payload)`) i `doX` async (la lògica original, executada des de `onConfirm`). Captura el payload/context a l'estat en obrir, perquè `doX` corre més tard (clau en callbacks d'editor com BlockEditor)."*

## 6. Components canòniques
- `src/components/ConfirmModal.jsx` — confirmacions binàries (`isDestructive` per a accions perilloses).
- `src/components/PromptModal.jsx` — entrada de text (substitut de `window.prompt`).
- `src/lib/toast` — `toast.error` / `toast.success` (substitut de `window.alert`).

## 7. Purga completa (sessió 2026-06-29)
Purgats: `VaultSwitcher`, `Dashboard` (3 confirm + 1 confirm pelat + member), `ContentCalendar`, `WorkspaceMembersPanel`, `DbViewEmbed` (confirm+prompt+alert), `SchemaConfigModal` (prompt), `BlockEditor` (prompt), i `alert` pelats a `SettingsModal`, `GlobalSettingsModal`, `social/Composer`, `VaultTable`, `ContactsPage`. Verificat: grep net + `npm run build` OK. (`MediaCenter` i `VaultTrashView` ja estaven fets.)

---
*Updated after a protocol failure detected in session ce6003d5.*
*Ampliat 2026-06-29: PromptModal + lliçó dels diàlegs pelats + purga completa.*

# Directive: Fix Calendar Event Deletion Errors

## Context
A visual error was detected where error notifications (toasts) appeared and disappeared quickly without leaving a console trace when deleting a calendar event.
1. Translation keys do not exist (`event_deleted`, `event_delete_error`).
2. External resource deletion attempts (e.g. Google Calendar) from endpoints that only accept local files (.md).

## Protocols for Resolution

### 1. Robust Translations
- All CRUD operations must define their translation keys in each language's JSON file.
- Never rely 100% on the default text of `t()` for critical error notifications.

### 2. Origin Validation (Local vs External)
- Before calling `axios.delete`, verify if the object has a local origin (`source === 'Gnosi'` or similar).
- If the citation is external, the delete button should be disabled or display an explanatory message indicating that it needs to be managed from the originating platform.

### 3. Error Management
- The `catch` block must ensure that the complete error is registered in the console before launching the *toast*.
- If the component can be "unmounted" during removal, operations of closure must wait for the API promise to resolve.

## Historical Changes
- **2026-04-10**: Corrected missing translation keys and added basic origin validation.

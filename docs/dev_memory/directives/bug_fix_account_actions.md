# Directive: Account Actions Logic and UI Validation

## Context
During the modernization of the Gnosi settings interface, a regression was identified in the account integration flow. Integrated account actions (Edit/Delete) were implemented as UI elements but lacked robust backend synchronization logic for updates, leading to duplicate entries.

## Logic Requirements

### 1. Unified Save Interface (Add/Edit)
The "Add Account" form must support both creation and edition.
- **State**: An `editingAccountId` state must be maintained.
- **Save Logic**:
    - If `editingAccountId` is null: Append new account to the list.
    - If `editingAccountId` is present: Update the existing account object within the list using `.map()`.
- **Completion**: Clear all form fields AND the `editingAccountId` state upon successful completion. Close the form.

### 2. Deletion Protocol
- **Persistence**: Account deletion must be persisted to the backend (`/api/integrations/bulk`) immediately after user confirmation.
- **Confirmation**: Use a custom `ConfirmModal` (Tailwind-based) instead of native dialogs.
- **Ordering**: Ensure the local state is updated AFTER the API call succeeds to reflect the true state of the backend.

## Quality Assurance (QA) Standards

> [!IMPORTANT]
> **Mandatory Browser Validation**:
> Developers MUST use the browser sandbox to physically interact with account action buttons (Edit, Delete, Save). It is NOT sufficient to verify code via static analysis.

- **Checklist**:
    - [ ] Create a manual account.
    - [ ] Edit the account and verify NO duplicate is created.
    - [ ] Delete the account and verify it is removed from the list.
    - [ ] Run `npm run build` to ensure no regression in types or imports.

## History of Failures
- **Failure 2026-04-13**: Account Edit button correctly populated fields but the "Save" handler always performed an append operation, resulting in duplicate accounts.

---
**Standard**: All directives must be written in English.

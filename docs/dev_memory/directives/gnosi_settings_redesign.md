# DIRECTIVE: SETTINGS_REDESIGN_AND_UNIFICATION

> ID: 2026-04-13
> Associated Script: monorepo/apps/gnosi/frontend/src/components/GlobalSettingsModal.jsx
> Status: ACTIVE

---

## 1. Objectives and Scope

Refactor and redesign the `GlobalSettingsModal.jsx` to follow the new component structure defined by the user, ensuring visual consistency across all sections (especially accounts) and alignment with backend services.

- **Main Objective:** Create a premium, consistent, and fully functional settings interface.
- **Success Criteria:** 
    - All 10 defined tabs (General, Language, Appearance, Calendar, Contacts, Mail, Subscriptions, Graph, AI, Zotero) are functional.
- Consistency across Calendar, Contacts, and Mail account management.
    - Design follows the Gnosi aesthetic (dark mode, glassmorphism, Lucide icons).
    - Unused legacy code is removed.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Backend APIs:**
    - `/api/config`: General, Language, Appearance, Graph, AI.
    - `/api/integrations`: Accounts for Calendar, Contacts, Mail.
    - `/api/reader/sources`: Subscriptions.
    - `/api/zotero/config`: Zotero.
- **Frontend Assets:** Lucide Icons, existing CSS variables.

### Outputs
- **Modified File:** `monorepo/apps/gnosi/frontend/src/components/GlobalSettingsModal.jsx`
- **Updated Config:** `params.yaml` (handled via API).
- **Updated Integrations:** `integrations.json` (handled via API).

## 3. Logical Flow (Algorithm)

1. **Information Gathering:** Load all configurations from backend on modal open.
2. **State Management:** Use local state for UI transitions and a unified "draft config" for changes.
3. **Componentization:** 
    - Use a common `Sidebar` component.
    - Create a reusable `AccountListSection` for Calendar, Contacts, and Mail.
    - Create specialized sections for Graph (physics/visibility) and AI (provider config).
5. **Email-aware account flow**:
    - Replace the static Google block with an email-entry flow.
    - Render the Google OAuth action only when the entered address validates
      as a Gmail account.
    - Share this behavior across Calendar, Contacts, and Mail.

## 4. Tools and Libraries
- **Frontend:** React, Lucide Icons, Axios, i18next.
- **Backend:** FastAPI, YAML (params), JSON (integrations).

## 5. Restrictions and Edge Cases
- **Secret Masking:** Ensure passwords/tokens remain masked (`********`) in the UI.
- **Persistence Conflicts:** Handle cases where the backend expects specific structures (e.g., merging vs. replacing).
- **Zotero Mapping:** Ensure target table fields are dynamically loaded.

## 6. Rationalizations

| Rationalization | Consequence |
| --- | --- |
| "Account sections can remain inconsistent because they already work." | False. Calendar, Contacts, and Mail require one coherent interaction model. |
| "Keep all old code indefinitely to be safe." | False. Refactor in verified increments and remove confirmed dead code. |

## 7. Red flags

- If `GlobalSettingsModal.jsx` exceeds 2,000 lines, extract focused
  subcomponents.
- If `/api/config` fails after switching Personal/Organization mode, inspect
  merge logic in `config_routes.py`.

## 8. Post-Execution Checklist (Verification Gates)

- [x] Save guards and debounce logic reviewed.
- [ ] Run current native frontend build and browser QA.
- [x] Subscription-source creation and listing verified.
- [x] AI-provider validation success state verified.
- [x] **Auto-save status indicator** visible and functional in the sidebar.
- [x] Universal folder selection through `FolderPickerModal` and
  `/api/system/browse`.
- [x] Minimal layout with compact language selection and no redundant side
  branding.

## 9. Additional Notes
The redesign must feel premium, using smooth transitions and a clear layout.

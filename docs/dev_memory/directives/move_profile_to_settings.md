# Directive: Move Identity Profile to Settings

## Context
The user requested that the profile data entry form (Identity Profile) should be located within the "Settings" section instead of being a standalone page accessible from the sidebar.

## Objectives
- Integrate `IdentityProfile.jsx` into `GlobalSettingsModal.jsx`.
- Remove the "Identitat" entry from `AppSidebar.jsx`.
- Clean up the `/identity` route in `App.jsx`.

## Implementation Details

### 1. Frontend Changes
- **AppSidebar.jsx**: Remove the object `{ to: '/identity', icon: User, label: 'Identitat' }` from `navItems`.
- **GlobalSettingsModal.jsx**:
    - Import `IdentityProfile` from `./Vault/IdentityProfile`.
    - Add a new `SidebarItem` with `id="profile"` in the sidebar navigation.
    - Add a new section in the main content area that renders `<IdentityProfile />` when `activeTab === 'profile'`.
- **App.jsx**: Remove the `<Route path="/identity" element={<IdentityProfile />} />`.

## Constraints & Learned Patterns
- `GlobalSettingsModal` uses a specific styling for its sections. `IdentityProfile` has its own padding and max-width which might need subtle adjustment if it looks too cramped or too loose.
- Ensure the "Perfil" tab is consistently translated or uses the appropriate label (e.g., "Identitat" to match previous naming).

## Verification Plan
1. Open Gnosi.
2. Verify "Identitat" is gone from the main sidebar.
3. Open "Settings" (Configuració).
4. Verify a new "Perfil" or "Identitat" tab exists.
5. Click it and verify the form loads and saves correctly.

# DIRECTIVE: WORKSPACES_RBAC_MANAGEMENT

> ID: 2026-04-06
> Associated Component: Backend (FastAPI) & Frontend (React)
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Systematize the access control and multi-tenant logic for the Gnosi ecosystem.
- **Success Criteria:** All mutation requests are validated by role, and the UI adapts dynamically to user permissions.

## 2. Input/Output (I/O) Specifications

### Inputs (Headers)
- `x-user-id`: String (Current user identifier, e.g., "ismael-legacy").
- `x-workspace-id`: UUID/String (The active workspace context).

## Arquitectura de Control (Admin Panel)

Per gestionar els membres i permisos des de la UI, s'han implementat els següents endpoints a `workspace_routes.py`:

- **GET `/api/workspaces/{workspace_id}/members`**: Llista tots els usuaris d'un workspace amb els seus rols. Requereix rol `admin` o superior.
- **PUT `/api/workspaces/{workspace_id}/members/{user_id}/role`**: Actualitza el rol d'un usuari. Requereix rol `admin` o superior (un admin pot promoure a admin, però només un owner hauria de promoure a owner en el futur - actualment permès per admin per simplicitat inicial).

### Jerarquia de Rols (ROLE_WEIGHTS)
El sistema utilitza pesos numèrics per validar permisos:
- `owner`: 3 (Control total)
- `admin`: 2 (Gestió de membres i configuració)
- `editor`: 1 (Lectura/Escriptura de contingut)
- `viewer`: 0 (Només lectura)

## Protocol de Verificació (QA)

1. **Backend (FastAPI)**:
    - Utilitzar `server.py` (Port 5002). `app.py` és llegat i conté errors d'importació.
    - Testejar amb `curl` els endpoints protegits per `require_role`.
2. **Frontend**:
    - Verificar que la pestanya "Administració" només apareix per a `admin/owner`.
    - Verificar que el `WorkspaceSwitcher` persisteix el rol correctament al `localStorage` (`gnosi_role`).

## Lliçons Apreses (Self-Correction)

> [!WARNING]
> **No et bloquegis a tu mateix**: Si canvies el teu propi rol a `editor` des del panell d'administració, perdràs l'accés a la pestanya d'administració immediatament. En aquest cas, caldrà restaurar el rol manualment a la base de dades (`data/management.sqlite`).

> [!NOTE]
> **Mode Personal**: Si `gnosi_mode` a `params.yaml` està setejat a `personal`, el sistema ignora els rols de la BD i assigna `owner` a l'usuari per defecte (`ismael-legacy`) per garantir que sempre tingui accés a tot en entorns monopuesto.
: 10 (Read-only)

## 3. Logical Flow (Algorithm)

### Backend Validation
1. Intercept request via `require_role(required_role)` dependency.
2. Fetch `Membership` for `user_id` and `workspace_id`.
3. Compare `member.role` weight against `required_role` weight.
4. If weight is insufficient, raise `HTTP 403 Forbidden`.

### Frontend Adaptation
1. Retrieve active `role` from `WorkspaceResponse` during workspace selection.
2. Persist `gnosi_role` in `localStorage`.
3. Use `useApi()` hook to broadcast the role to components.
4. Disable inputs, hide "+" buttons, and set `BlockNoteView` to `editable={false}` if role is `viewer`.

## 4. Restrictions and Edge Cases

- **Missing Membership:** If a user is not a member of the workspace, access is denied (403).
- **Default Role:** If no role is specified, the system defaults to `viewer`.
- **LocalStorage Sync:** If `localStorage` is manually cleared, the frontend must re-fetch the role to restore functionality.

## 5. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 06/04 | 403 on mutation | Missing `require_role` | Applied decorator to all POST/PUT/DELETE routes. |
| 06/04 | Viewer could type | `editable` prop missing | Controlled `BlockNoteView` with `isEditable` state. |

## 6. Verification and Testing (Manual Activation)

To test specific permission levels in the browser:
1. Open DevTools -> Application -> Local Storage.
2. Edit `gnosi_role` to `viewer`, `editor`, or `admin`.
3. Refresh page (F5) to see UI changes.

---

## 7. Pre-Execution Checklist
- [x] Verify `memberships` table has valid entries for the test user.
- [x] Ensure `x-workspace-id` is sent in API calls via `useApi`.

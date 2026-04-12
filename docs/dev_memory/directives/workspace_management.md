# Directive: Workspace and Permission Management in Gnosi

## Context
Gnosi is evolving from a single repo/vault system to a multi-tenant system organized by workspaces. This directive establishes the architectural foundations for access and security.

## Objectives
1. Allow the coexistence of multiple independent workspaces.
2. Implement a Role-Based Access Control (RBAC) system for users.
3. Ensure that vaults from different workspaces do not share data.

## Implementation Protocol

### 1. Directory Structure
Each workspace's data must be physically isolated:
*   `workspaces/<workspace_id>/vault/`
*   `workspaces/<workspace_id>/assets/`
*   `workspaces/<workspace_id>/config/`

### 2. Identity and Session Management
*   Use an identity provider (LDAP, Google OAuth, or custom login) that returns a `user_id`.
*   The backend must validate that the `user_id` belongs to the requested `workspace_id` in every request.

### 3. Permission Matrix (Roles)
| Role | View | Edit | Delete | Manage Members |
| :--- | :---: | :---: | :---: | :---: |
| **OWNER** | ✅ | ✅ | ✅ | ✅ |
| **ADMIN** | ✅ | ✅ | ✅ | ✅ |
| **EDITOR** | ✅ | ✅ | ❌ | ❌ |
| **VIEWER** | ✅ | ❌ | ❌ | ❌ |

## Restrictions and Warnings
*   **Idempotency**: All workspace changing operations must be atomic.
*   **Migration**: The system must support a default workspace for legacy installations.
*   **Security**: Never trust the `workspace_id` sent by the client without validating permissions on the server.

---
*Created by Antigravity - April 2026*

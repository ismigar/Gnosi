# Directiva: Gestión de Workspaces y Permisos en Gnosi

## Contexto
Gnosi evoluciona de un sistema de un solo repositorio/vault a un sistema multi-inquilino organizado por espacios de trabajo (Workspaces). Esta directiva establece las bases arquitectónicas para el acceso y la seguridad.

## Objetivos
1.  Permitir la coexistencia de múltiples workspaces independientes.
2.  Implementar un sistema de Roles (RBAC) para usuarios.
3.  Asegurar que los vaults de diferentes workspaces no compartan datos.

## Protocolo de Implementación

### 1. Estructura de Directorios
Los datos de cada workspace deben estar aislados físicamente:
*   `workspaces/<workspace_id>/vault/`
*   `workspaces/<workspace_id>/assets/`
*   `workspaces/<workspace_id>/config/`

### 2. Gestión de Identidad y Sesión
*   Utilizar un proveedor de identidad (LDAP, Google OAuth o login propio) que devuelva un `user_id`.
*   El backend debe validar que el `user_id` pertenece al `workspace_id` solicitado en cada petición.

### 3. Matriz de Permisos (Roles)
| Rol | Ver | Editar | Borrar | Administrar Miembros |
| :--- | :---: | :---: | :---: | :---: |
| **OWNER** | ✅ | ✅ | ✅ | ✅ |
| **ADMIN** | ✅ | ✅ | ✅ | ✅ |
| **EDITOR** | ✅ | ✅ | ❌ | ❌ |
| **VIEWER** | ✅ | ❌ | ❌ | ❌ |

## Restricciones y Advertencias
*   **Idempotencia**: Todas las operaciones de cambio de workspace deben ser atómicas.
*   **Migración**: El sistema debe soportar un workspace por defecto para instalaciones legacy.
*   **Seguridad**: Nunca confiar en el `workspace_id` enviado por el cliente sin validar los permisos en el servidor.

---
*Creado por Antigravity - Abril 2026*

# Workspace RBAC

> Historical implementation note. See `auth_multiuser_design.md` for current
> security requirements.

## Roles

Workspace roles are ordered:

- Owner.
- Administrator.
- Editor.
- Viewer.

Member listing and role updates require administrator or owner privileges.
Owner promotion and demotion require stricter owner-only safeguards.

## Personal mode

Personal mode assigns the local user owner access and does not expose a login
gate. Organization mode enforces authenticated membership and vault grants.

## Safety

- Prevent users from accidentally removing their own last administrative path.
- Do not trust UI visibility as authorization.
- Keep role changes auditable.
- All administration labels use i18n with English defaults.

## QA

Use the live FastAPI application entry point and an isolated organization-mode
database. Verify role hierarchy, endpoint authorization, administration-tab
visibility, self-demotion safeguards, and unchanged personal mode.

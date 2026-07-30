# Authentication and Multi-User Design

> Status: design complete. Existing authentication is substantial; the
> remaining work is security-critical hardening for team self-hosting.

## Existing foundation

- Email/password registration, login, logout, and current-user endpoints.
- Bcrypt password hashing and signed HttpOnly session cookies.
- Identity priority: JWT, then personal-mode compatibility headers, then the
  legacy personal identity.
- Workspace RBAC: owner, admin, editor, viewer.
- SQLAlchemy models for users, workspaces, memberships, vaults, and vault
  access.
- Personal mode without login and organization mode with authentication.
- Frontend auth context and login gate.

The compatibility user header is not an authorization mechanism in
organization mode.

## Critical gaps

### Per-user secrets

The integration manager must not expose one global credential set to all
members. OAuth tokens, IMAP passwords, and personal API keys are per-user and
encrypted at rest. Shared infrastructure credentials remain instance-level.

Background mail and integration jobs run per user with that user's credentials.

### Enforced vault access

Backend I/O must validate vault access for every target path. Frontend headers
and filtering are not enforcement.

Implement at a central filesystem/service chokepoint rather than duplicating
checks across thousands of route lines.

Personal mode remains a strict no-op for authorization and retains full local
access.

## Granular authorization

Add groups and allow-only grants:

```text
subject: user or group
scope: vault + path_prefix
capabilities: read, write, delete, share
```

Applicable user and group grants are resolved for the target path. The most
specific matching prefix wins, with allowed capabilities combined at that
specificity. Workspace owners and administrators retain full baseline access.

Keep the model deliberately smaller than Drupal permissions: four
capabilities, path prefixes, groups, and no deny rules in the first version.

## Production hardening

After critical gaps:

- Login rate limiting.
- Password reset with expiring tokens.
- Email verification.
- Server-side session revocation.
- Stronger CSRF protection where needed.
- Audit logs for membership and permission changes.
- Optional two-factor authentication.

Social login is a later feature; current Google and Microsoft OAuth routes are
for integrations, not authentication.

## Implementation order

1. Per-user encrypted secrets.
2. Central vault-access enforcement.
3. Path-prefix and group grants.
4. Login rate limiting, password reset, and email verification.
5. Revocation, CSRF, audit, and optional 2FA.

Extend existing auth services, workspace services, and management models; do
not replace them.

## Test environment

Do not switch the maintainer's daily personal instance into organization mode.
Create an isolated organization-mode backend with:

- Separate port.
- Temporary management database and vault.
- Two users and at least two roles.
- A read-only grant to one subtree.

Verify access inside the subtree, denial outside it, and write denial. Every
increment also runs personal-mode regressions to prove the desktop workflow is
unchanged.

## Locked product decisions

- Distribution model: desktop application plus team self-hosting, not SaaS.
- Personal connected accounts use per-user secrets.
- Organization background jobs operate per user.
- Granular authorization uses groups, path prefixes, four capabilities, and
  allow-only rules.
- Implementation is incremental and test-driven.

## Restrictions

- Temporary attachments belong to one vault/workspace/user/agent/session scope.
  Upload, consume, and delete recompute that scope and reject cross-scope paths.

- Never trust a client-selected vault or path.
- Never store all members' tokens in one file.
- Never spread authorization checks endpoint by endpoint when a central I/O
  layer can enforce them.
- Never weaken personal mode while adding team behavior.
- Do not rush a security-critical refactor without the isolated organization
  test bank.
- Never scope assistant browser history or LangGraph checkpoints by Vault and
  session alone. Include the authenticated workspace and user in storage keys,
  checkpoint filenames, thread IDs, locks, deletion, and response guards.

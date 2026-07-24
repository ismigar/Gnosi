# Publish the Gnosi Google OAuth Application

> ID: `GOOGLE-PUBLISH-20260507`
> Purpose: avoid refresh-token restrictions associated with Google OAuth
> testing mode.

## Context

Google OAuth testing mode may impose short refresh-token lifetimes and a test
user limit. Moving the consent screen to production can remove testing-mode
constraints, although sensitive or restricted scopes may require additional
verification depending on audience and current Google policy.

Before applying this runbook, verify current requirements in Google Cloud
documentation.

## Procedure

1. Open Google Cloud Console and select the project matching the configured
   OAuth client.
2. Open the OAuth consent screen.
3. Confirm application name, support email, developer contact, home page,
   privacy policy, and authorized domains.
4. Review every requested scope, especially full-mail access used by
   IMAP/SMTP XOAUTH2.
5. Publish to production if the application's audience and compliance posture
   are appropriate.
6. Reauthorize existing accounts so newly issued tokens use the production
   consent configuration.
7. Check `/api/auth/google/health` and complete mail, calendar, and contacts
   smoke tests.

The public authorized domain hosts application information. A localhost
redirect URI remains a separate OAuth client setting.

## Privacy policy

The policy must accurately explain:

- Which Google data Gnosi accesses.
- That connected-account data is processed and stored according to the actual
  deployment.
- Whether any external services receive it.
- How the user revokes access.
- A valid contact address.

Do not publish a copied policy that does not match current product behavior.

## Testing mode

Remaining in testing mode can be appropriate during development or for a
controlled tester set. The UI must explain reauthorization failures clearly.
Proactive access-token refresh does not supersede provider refresh-token
policy.

## Formal verification

A broadly distributed product using sensitive or restricted scopes may require
domain verification, scope justification, a demonstration, and a security
assessment. Treat cost and requirements as current external facts and verify
them before planning.

## Rollback

The consent screen can return to testing if production causes an unexpected
issue. Validate token and user impact before changing status.

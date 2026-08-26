# Vault-scoped routes and API

## Objective

Make every private Gnosi deep link self-contained by encoding the vault, the
application surface, the resource type, and the immutable resource identifier.
The browser route is the source of truth for vault selection, while backend
authorization remains the source of truth for access.

## Canonical contract

- Private browser routes use the hierarchy `@vault-slug`, application, resource
  type, and resource identifier.
- Application landing routes stop at the application segment when no concrete
  resource is selected.
- Nested resources preserve ownership, such as a view below its table.
- Knowledge documents use their real resource kind: `page`, `dashboard`,
  `table`, `table/{tableId}/view`, or `drawing`, followed by the immutable id.
- Stable English route keys are used independently of the translated interface.
- Vault display names are mutable. Vault slugs are stable, globally unique,
  URL-safe, and persisted separately from display names. Global uniqueness lets
  the routing middleware resolve the vault before workspace dependencies run;
  authorization still rejects vaults outside the authenticated workspace.
- Public share links, authentication, settings, and other global surfaces stay
  outside the vault-scoped namespace.

## API contract

- Vault data APIs use the versioned hierarchy `api/v1/vaults`, vault slug,
  application, and the existing resource path below that application.
- The canonical API path resolves the vault before endpoint dispatch and takes
  precedence over legacy headers, query parameters, cookies, or browser state.
- The resolved database identifier continues to be used for authorization and
  filesystem selection. A slug is routing metadata, never proof of access.
- Management APIs that list, create, rename, or delete vaults remain global
  because they act on the vault collection rather than data inside one vault.
- Legacy API paths remain temporary aliases during migration without changing
  request semantics; new callers use the canonical hierarchy.

## Application mapping

- Knowledge owns pages, tables, views, dashboards, drawings, files, templates,
  indexes, search, collaboration, and the other generic vault operations.
- Graph owns graph topology and graph-specific views.
- Calendar owns calendar data and meeting surfaces.
- Mail owns mail data.
- Reader owns feeds and reading-history data.
- Resources owns literature search, reviews, and repositories.
- Planning owns project-planning data.
- Notebooks owns grounded notebooks.
- Automations owns schedules and automation execution.
- Social owns publishing and social media operations.
- Contacts owns contact data.
- AI owns assistant and agent operations that are scoped to a vault.

## Compatibility and migration

- Existing browser links redirect to the equivalent canonical route using the
  currently selected or primary vault, preserving query parameters and hashes.
- Existing API clients continue to work during the compatibility window.
- A vault rename does not silently change its slug. If slug editing is added in
  the future, historical aliases must redirect to the current canonical slug.
- Central route builders and parsers own URL construction. Feature components
  must not concatenate canonical vault routes independently.
- The active-vault selector navigates to the same application in the target
  vault when possible and otherwise uses that application's landing route.

## Verification

- Test slug generation, normalization, uniqueness, migration backfill, and
  workspace isolation.
- Test canonical API dispatch, precedence over conflicting legacy vault state,
  unknown vaults, unauthorized vaults, query strings, streaming endpoints, and
  legacy aliases.
- Test direct browser loading, refresh, back and forward navigation, vault
  switching, old-link redirects, nested table views, pages, graph, calendar,
  and public shares.
- Run focused backend and frontend tests, the frontend production build, the
  native backend startup check, browser inspection, and an end-to-end API call.

## Restrictions and edge cases

- Do not use the mutable vault display name as the persisted route key because
  renaming it would invalidate bookmarks; use a separate stable slug.
- Do not place arbitrary vault slugs directly at the root because they can
  collide with global application routes; reserve the `@` namespace.
- Do not trust a slug or client-selected vault identifier for authorization
  because it could expose another workspace; resolve it within the authenticated
  workspace and retain central access enforcement.
- Do not mount duplicate FastAPI routers for every canonical prefix because
  startup and OpenAPI generation become expensive and route names collide; use
  one canonical dispatch layer that preserves the original endpoint contracts.
- Do not redirect mutating legacy API requests because redirects can change
  methods or break streaming clients; dispatch them compatibly.
- Do not remove legacy routes in the same release because stored page links,
  browser bookmarks, integrations, and older desktop clients still use them.
- Do not use a synchronous list callback as an ASGI `send` test double because
  middleware awaits the channel and the test fails with a `NoneType` await
  error; wrap capture in an asynchronous function instead.
- Do not declare a React Router segment as `@:vaultSlug` because version 7 does
  not parse partial dynamic segments; capture the complete segment and validate
  plus strip the leading `@` inside the scope guard.
- Do not synchronously reset route-resolution state inside a React effect
  because the hooks lint treats it as a cascading render; derive readiness from
  the active and resolved slugs and update only from the asynchronous resolver.

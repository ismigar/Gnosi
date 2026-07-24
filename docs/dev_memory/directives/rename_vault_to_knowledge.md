# Directive: Rename Vault to Knowledge

## Context

The database-and-Wiki section was renamed from **Vault** to **Knowledge**.
`Vault` now means the complete storage container, while `Knowledge` identifies
the user-facing data and document section.

## Objective

Keep terminology consistent throughout the application. Show "Knowledge" or
its locale translation when referring to the database-and-Wiki section.

## Locale values

- English: Knowledge
- Catalan: Coneixement
- Spanish: Conocimiento
- French: Connaissance

These localized endonyms are intentional product data. <!-- @language-example -->

## Rules

- Prefer changing visible localized values rather than translation keys.
- Do not rename keys unless all code references are migrated together.
- Change "My Vault" to "My Knowledge" only when it refers to the section.
- Do not rename storage concepts such as `vault_path`; those changes affect
  persistence and backend contracts.

## Multi-vault update (2026-07-04)

- `useActiveVaultName.js` centralizes initial reads from
  `gnosi_active_vault_name` and asynchronous synchronization with
  `/api/vaults`, preventing display flicker.
- A `Vault: {vault name}` badge appears wherever users need active-vault
  context: Knowledge, Knowledge Graph, Media Manager, Mail, standard
  `AppHeader` screens, Home, Social Dashboard, Task Scheduler, and Composer.
- Store the active vault name in localStorage whenever `/api/vaults` is read
  or `VaultMenu`/`VaultSwitcher` changes the selection. Components can then
  initialize synchronously after a reload.

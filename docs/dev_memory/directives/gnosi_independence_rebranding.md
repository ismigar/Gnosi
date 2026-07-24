# Directive: Gnosi independence and rebranding

> ID: 2026-04-07
> Status: ACTIVE

## Objective

Transition Gnosi from a Notion-import viewer into an independent application.
Remove active Notion-import branding from UI, communication, and business
logic except where it describes real historical data migration.

Success means public documentation, UI, and active component names use Gnosi
or Vault terminology, while actual Notion integration code remains explicit.

## Inputs and outputs

- Inputs: source under `monorepo/apps/gnosi` and developer directives.
- Outputs: safely refactored code and current English documentation.

## Classification

Classify every occurrence before changing it:

- **Identity:** project names, logos, and page titles → change.
- **Internal Gnosi data:** variables named `notion_*` that no longer represent
  Notion → migrate with all references.
- **Integration:** import functions, migration scripts, Notion API clients,
  persisted source fields, and credentials → keep and clarify.

Update documentation first, refactor identifiers with language-aware tooling,
then run build and tests.

## Restrictions

- Do not rename classes or methods that genuinely call the Notion API.
- Keep established Notion credential environment names until a deliberate
  compatibility migration exists.
- After renaming a React component, verify every import and dynamic registry
  reference.
- Prefer `rg` and IDE-aware symbol refactoring over blind text replacement.

Example audit:

```bash
rg -n "Notion import connector" monorepo/apps/gnosi docs
```

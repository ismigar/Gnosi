# Vault Spreadsheet Live Engine

> Historical design record.

## Objective

Recalculate formula fields on record creation and update, including dependency
propagation within one record.

## Flow

1. Load the active table schema from the record's table identity.
2. Extract formula dependencies.
3. Build a topological evaluation order.
4. Detect and report cycles.
5. Evaluate through a restricted expression engine.
6. Persist deterministic derived values.
7. Use equivalent frontend logic only for immediate preview.

## Restrictions

- Never execute arbitrary Python or JavaScript.
- Convert user-facing placeholders to internal safe tokens before evaluation.
- Missing values use explicit type-aware defaults.
- Formula errors are non-blocking and logged in English.
- Do not run E2E while backend reload is actively replacing modules.
- Build from the frontend directory when validating frontend scope.

## QA

Cover dependency chains, cycles, missing values, invalid formulas, create,
update, deterministic persistence, and frontend/backend parity.

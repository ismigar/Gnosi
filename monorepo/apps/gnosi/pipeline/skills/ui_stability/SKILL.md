# Directive: GraphPage field-filter TypeError fix

## Context

`GraphPage.jsx` raised
`Uncaught TypeError: Cannot read properties of undefined (reading 'name')`
while rendering dynamic field filters. It occurs when a table is absent from
the available-table list, including system entities such as `wiki` or
`images`.

## Cause

Inside the `visibleFields.map` filter block, the `<h5>` label accessed
`table.name` directly even though the component had already computed a safe
`tableName` fallback for cases where `table` is undefined.

## Fix

1. Use the precomputed `tableName` instead of `table.name`.
2. Make every other table access in this context null-safe with optional
   chaining where appropriate.

## Execution

1. Locate `visibleFields.map` in `GraphPage.jsx`.
2. Replace `{table.name}` with `{tableName}`.
3. Check the surrounding block for unsafe table access.

## QA

1. Run `npm run build` in `frontend`.
2. Open the graph page and verify field filters render without errors,
   especially for system fields.

# Heading Spacing Adjustment

## Objective

Use margins, not vertical padding, for editor heading spacing. Apply any
background highlight to the text area without painting through the surrounding
vertical whitespace.

## Rules

- Reset inherited heading padding inside `.bn-editor`.
- Define vertical rhythm with `margin-top` and `margin-bottom`.
- Use a text-level wrapper or suitable inline layout for background color.
- Preserve block layout when full-width behavior is required.
- Use `!important` only when necessary to override injected library styles.

## QA

Inspect computed styles and verify every heading level, background highlight,
selection, line wrapping, and light/dark theme behavior.

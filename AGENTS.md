# Gnosi project instructions

## Interface consistency

- Always use the app's existing styles, shared components, and theme tokens when adding or changing UI.
- Reuse existing buttons, fields, tabs, typography, spacing, and interaction patterns before introducing new styles.
- Ensure styles load on direct navigation as well as after opening settings, and respect the app's supported themes and responsive layouts.
- Keep user-facing language clear and nontechnical; maintain the Catalan, English, Spanish, and French translations.
- Use the shared `RefreshButton` for refresh actions at the upper-right of the relevant page or section. Use `GnosiToggle` for on/off settings instead of native checkboxes.

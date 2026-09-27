# Gnosi project instructions

## Interface consistency

- Always use the app's existing styles, shared components, and theme tokens when adding or changing UI.
- Reuse existing buttons, fields, tabs, typography, spacing, and interaction patterns before introducing new styles.
- Ensure styles load on direct navigation as well as after opening settings, and respect the app's supported themes and responsive layouts.
- Keep user-facing language clear and nontechnical; maintain the Catalan, English, Spanish, and French translations.
- Use the shared `RefreshButton` for refresh actions at the upper-right of the relevant page or section. Use `GnosiToggle` for on/off settings instead of native checkboxes.

## Local desktop updates

- Before replacing an installed Gnosi frontend or backend, inspect `Contents/Resources/reconciled-build.json` when present. Preserve every source commit/PR recorded there; build from a branch containing the installed changes and the new work.
- Record the source commit, branch and included PRs in that manifest after verification. Updating only one component must not replace changes from another active PR.
- Keep application backups compressed, or outside `.app` bundles, so macOS does not register them as duplicate applications. Preserve user data and source changes separately from app binaries.

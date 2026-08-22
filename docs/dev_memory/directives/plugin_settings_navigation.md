# Plugin Settings Navigation Directive

## Objective

Ensure that every enabled built-in plugin with a configuration control leads to
an available configuration surface.

## Behavior

- Plugins with a dedicated configuration panel inside the plugin catalogue
  expand that panel from their configuration control.
- Plugins whose configuration belongs to a global Settings section navigate to
  that section from their configuration control.
- A configuration control must never silently do nothing.

## Verification

- Build the frontend successfully.
- In the running application, enable a configurable plugin, select its
  configuration control, and verify that its fields are visible.

## Restrictions and Edge Cases

- Do not pass an optional callback without wiring it in the parent settings
  modal: the button then accepts clicks without any visible result.
- Do not route a plugin to a tab identifier that has no rendered Settings
  section: keep dedicated plugin forms in the plugin catalogue instead.

# Calendar Sidebar UI

## Objective

Centralize calendar-management actions in a clean sidebar header and remove
redundant controls from the footer.

## Rules

- Place the add/manage action in the top section.
- Remove duplicate add buttons at the bottom.
- Use the standard application event for opening settings.
- Apply the same hover and color transition as other compact icon actions.
- Route every label and tooltip through i18n.
- Add every key to Catalan, English, Spanish, and French resources; English is
  the default.

## QA

Verify the action opens the correct settings section, no duplicate control
remains, focus and tooltip behavior are accessible, and the sidebar works in
light/dark and narrow layouts.

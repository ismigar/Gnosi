# Vault Slash Commands and Suggestions

> Historical implementation record.

## Objective

Provide useful slash commands for databases and views, plus wikilink and
transclusion suggestions for existing or newly created pages.

## Rules

- Build the command catalog with explicit editor and table context.
- Filter defensively when a command lacks a title or aliases.
- Typing `[[` suggests internal pages.
- Typing `![[` suggests transclusions.
- Suggestions may create a missing page in Wiki or a selected table, then
  insert its stable link.
- Database commands insert functional custom blocks and allow table selection.
- All command titles and descriptions use i18n with English defaults.

## QA

Verify database/view insertion, table selection, existing-page links,
contextual page creation, transclusion insertion, keyboard navigation, Escape,
and save/reload.

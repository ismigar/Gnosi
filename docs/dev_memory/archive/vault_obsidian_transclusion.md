# Vault and Obsidian Transclusion

> Historical implementation record.

## Objective

Support `![[Page]]` and `![[Page#Section]]` embeds while keeping portable
Obsidian syntax.

## Behavior

- Suggest hierarchical headings after typing a page and section delimiter.
- Resolve targets by stable ID or unique title.
- Render a bounded preview of the full page or selected section.
- Stop section extraction at the next heading of equal or higher level.
- Preserve a readable textual fallback when the target is unavailable.
- Allow insertion through slash and wikilink suggestion menus.

## Restrictions

- Custom parsing must run before generic paragraph parsing.
- Heading suggestions include title, level, and parent path.
- Missing targets never break save or editor rendering.
- Every visible fallback uses i18n with English defaults.

## QA

Test insertion, save/reload, full-page and section embeds, hierarchy
suggestions, renamed targets, missing pages, and external Obsidian round-trip.

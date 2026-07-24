# Vault Mail Integration

> Historical architecture bridge; current implementation details live in the
> mail skills and directives.

## Objective

Turn external email into searchable, structured vault knowledge.

Each persisted message has stable identity, sender, recipients, date, subject,
content, and account/folder context. Indexed messages appear in appropriate
views without exposing raw internal state.

Frontmatter, table IDs, synchronization, and write behavior follow the current
mail implementation. All visible UI text uses i18n with English defaults.

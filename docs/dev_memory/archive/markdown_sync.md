# Markdown Synchronization

> Historical design record.

## Objective

Keep Gnosi editor structures portable as readable Markdown and preserve a
stable round-trip with external editors such as Obsidian.

## Principles

- Prefer standard Markdown for ordinary content.
- Use explicit fenced or directive syntax for custom blocks.
- Preserve custom structures that an external editor does not understand.
- Store stable block IDs only when a feature such as block comments requires
  them.
- Keep syntax understandable to both people and language models.

## Round-trip

1. User edits in Gnosi.
2. Serializer writes canonical Markdown.
3. External tools may edit the file.
4. Gnosi parses the updated Markdown without losing supported structures.

Every new block requires parser, serializer, idempotence, external-edit, and
browser tests.

# Directive: Embedded resource actions and source templates

## Objective

Resource-table controls must be available from every embedded table view, not
only from the full table header. A record created from metadata must start from
the template appropriate to its detected document type.

## Procedure

1. Gate the embedded controls with the configured reference-table ID rather
   than a table name or a Citation Key heuristic.
2. Reuse the reference import/export control in embedded views, and extend the
   existing New split button with Create from a source.
3. Pass the configured reference-table ID and source-creation callback through
   the editor context so page and dashboard embeds have the same actions.
4. Normalize both the lookup result and template Item Type to the canonical
   Zotero type before matching.
5. If a type-matching template exists, copy its content and metadata before
   applying imported metadata. Otherwise use the table default template.

## Verification

1. Run the resource-template selection unit test.
2. Run the frontend linter and a direct Vite production build.
3. In the native app, open a dashboard or page containing a Resources embed;
   confirm Import, Export, New, and Create from a source are present.
4. Create a source whose detected type has a matching template and confirm the
   new record contains that template's content.

## Restrictions and edge cases

- Do not compare translated Item Type labels directly: their locale can differ
  from the metadata lookup response. Normalize both values to the canonical
  Zotero type first.
- Do not replace imported metadata with template metadata: the source result
  is authoritative for bibliographic fields, while the template provides the
  document body and any missing metadata.
- Do not expose reference import/export actions in non-reference tables; the
  configured reference-table ID is the single source of truth.
- Do not use a native `title` tooltip on an action that opens a menu: browsers
  can keep it above the menu after the pointer moves. Use `aria-label` for the
  accessible name instead.

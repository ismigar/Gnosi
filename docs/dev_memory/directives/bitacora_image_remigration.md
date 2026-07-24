# Directive: Bitacora image remigration

## Purpose

Recover embedded images lost when an initial Notion ZIP import copied
Markdown files without their sibling image directories. Preserve edited text
and rewrite image references only.

## Diagnosis and decision

Bitacora pages contained relative `![alt](folder/image.jpg)` references but no
local image directories. Filenames ended with a 32-character Notion page ID.

Extract the page ID from each filename, fetch image blocks from the Notion API,
download them to a table-specific asset directory, and replace Markdown
references. Do not regenerate page text.

## Conventions

- Destination: `Assets/Bitacora/`.
- Filename:
  `<safe_original_name>_<page_id_prefix>_<index>.<extension>`.
- Markdown target: `/api/vault/assets/Bitacora/<filename>`, using URL encoding
  where needed.

These historical folder names are persisted data and remain unchanged.

## Procedure

The sandbox script:

1. Reads table Markdown files.
2. Extracts the trailing Notion page ID.
3. Paginates `GET /v1/blocks/{page_id}/children`.
4. Downloads Notion-hosted image blocks with collision-safe names.
5. Rewrites image references while preserving alt text.
6. Skips an existing same-size destination.
7. Writes a one-time `.bak` before modifying a page.

Run a dry run and a small limit before the complete migration.

## Restrictions

- Notion file URLs expire in about one hour. Fetch a fresh URL immediately
  before download.
- Skip filenames without an extractable page ID and report them.
- Preserve external images by default; mirror them only through an explicit
  option.
- Respect Notion rate limits.
- Re-running must not duplicate files or rewrite already-local references.
- Do not modify pages without images.

After successful verification, consolidate the parameterized tool under
`pipeline/skills/notion_image_remigration/`.

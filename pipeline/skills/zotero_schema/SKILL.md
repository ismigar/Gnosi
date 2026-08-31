---
name: zotero-schema
description: Generate Gnosi's Python and TypeScript item-type constants from the repository-pinned Zotero schema, or perform an explicitly requested pinned schema refresh. Use for mapping or generated-constant maintenance, not runtime downloads.
---

# Skill: Zotero Schema

The source of truth for Gnosi item types and fields, derived from Zotero's
official data schema. Gnosi does not depend on the Zotero application. It
vendors factual data from `schema.json` to avoid manually maintaining
Zotero-to-CSL mappings and multilingual labels.

> ID: ZOTERO-SCHEMA-20260528
> Stack: Python 3.10+ standard library; Node is not required
> Pinned version: `42` · commit `62e983a2e575fe9b9a3677ad7c9772080b67a1e4` (2026-03-16)
> Source: https://github.com/zotero/zotero-schema

## Generated outputs

The build reads repository-pinned [`schema.json`](./schema.json), never a
runtime download, and writes:

| Generated file | Consumer |
|---|---|
| `backend/services/zotero_schema.py` | `vault_routes.py`, replacing hard-coded `_RECURSOS_TYPE_TO_CSL` |
| `frontend/src/generated/zoteroSchema.ts` | Typed frontend consumers through `components/Vault/zoteroSchema.ts` |

Both Python and TypeScript expose the same constants:

- `SCHEMA_VERSION`: current schema version, currently `42`.
- `SCHEMA_SOURCE_SHA`: first 16 characters of the pinned file SHA-256.
- `ALL_ITEM_TYPES`: sorted list of 40 types such as `book`,
  `journalArticle`, `preprint`, and `dataset`.
- `ZOTERO_TO_CSL_TYPE`: `{zoteroType: cslType}`.
- `ZOTERO_TYPE_LABELS`: `{locale: {zoteroType: translatedLabel}}` for
  `ca-AD`, `es-ES`, `en-GB`, and `en-US`.
- `LABEL_TO_ZOTERO_TYPE`: inverse labels used to resolve legacy frontmatter
  that stores translated labels instead of canonical keys.

## Commands

```bash
# Regenerate constants from the local schema deterministically.
python3 pipeline/skills/zotero_schema/scripts/build_constants.py

# Refresh schema.json to the newest zotero/zotero-schema version.
python3 pipeline/skills/zotero_schema/scripts/refresh_schema.py

# Refresh to a specific commit for a controlled hotfix or downgrade.
python3 pipeline/skills/zotero_schema/scripts/refresh_schema.py --ref <SHA>
```

After `refresh_schema.py`, always run `build_constants.py` and update the
"Pinned version" line in this file.

## Validation

`backend/tests/test_zotero_schema.py` verifies in CI:

1. **Build idempotency:** rebuilding from the current schema exactly matches
   committed output.
2. **Python/TypeScript consistency:** both outputs have identical
   `ALL_ITEM_TYPES` and `ZOTERO_TO_CSL_TYPE` keys.
3. **Coverage:** every current Vault `Item Type` resolves either directly
   through `ZOTERO_TO_CSL_TYPE` or through
   `LABEL_TO_ZOTERO_TYPE['ca-AD']`.

A Zotero schema format change fails test 1. An unsupported free-form
frontmatter value fails test 3 and lists orphaned values.

## Restrictions and edge cases

- **License:** `zotero/zotero-schema` does not explicitly declare a license.
  The schema represents factual data-model information. Generated headers
  attribute the source. Review this decision if Zotero later clarifies its
  licensing.
- **Deterministic build:** sort keys alphabetically for stable diffs even when
  upstream JSON ordering changes.
- **Strict pinning:** update only through `refresh_schema.py` and an explicit
  commit. Never download the schema during runtime or CI.
- **Multiple CSL types:** a Zotero type can rarely list more than one
  `csl.types` value. Select the first alphabetically and emit a stderr warning.
- **Missing locales:** fall back to the canonical English key when a locale
  lacks a label.
- **Legacy frontmatter:** existing Vault pages can store Catalan labels such
  as `"Article de revista acadèmica"` rather than `"journalArticle"`.
  `LABEL_TO_ZOTERO_TYPE['ca-AD']` supports those persisted values without a
  frontmatter migration.
- **Frontend output:** generate the large catalogue inside
  `frontend/src/generated/` so source guardrails recognize it as generated.
  Keep `components/Vault/zoteroSchema.ts` as a small stable re-export for
  existing consumers. Never regenerate production JavaScript.

## Learning history

| Date | Learning | Resolution |
|---|---|---|
| 2026-05-28 | Python and JavaScript maintained separate hard-coded type maps, so new Zotero types drifted. | Added this skill as a single pinned schema source with deterministic Python and JavaScript generation. |
| 2026-08-29 | The generated frontend catalogue remained a 517-line production JavaScript file during the strict TypeScript migration. | Moved deterministic output to `frontend/src/generated/zoteroSchema.ts`, added explicit readonly types and retained a small stable TypeScript facade. |

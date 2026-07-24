---
name: translate_gaps_implementation
description: Complete translation UI and lifecycle gaps with row actions, context-aware menus, idempotency, bulk translation, and stale markers.
type: directive
status: active
related:
  - translate_row_skill
  - translate_page_skill
---

# Directive: Complete content translation workflows

`translate_row` and `translate_page` already provided backend translation, but
UI triggers and lifecycle behavior were incomplete.

## Completed gaps

### Row action

Show a translation action in each row's action cell when the table has
`translation_enabled` and the row is not itself a translation.

### Context-aware page menu

For a record in a translatable table, open translation in row mode so fields
become a child item. For ordinary pages, use page mode so title and body become
a child page. Resolve through `resolvePageTableId` and table configuration.

### Idempotency

Before creating a translation, find an existing
`(translation_origin_id, translation_lang)` record. Update it and clear
`translation_stale` rather than creating a duplicate.

### Tests and bulk operations

Keep pure helpers in `backend/services/translation_helpers.py` for isolated
pytest coverage. The bulk endpoint accepts `item_ids[]` and reuses the
single-row implementation. `VaultBulkActionsBar` exposes the i18n-backed
action.

### Stale markers

When translatable content on an original changes, a background task marks its
translations with `translation_stale: true`. Do not regenerate automatically;
that is expensive and risky, while retranslation is already idempotent.

## Restrictions

- Autosave must not create write storms. Never mark a translated child stale,
  and only mark when title, body, or translatable fields changed.
- `_set_page_metadata_flag` must skip writing an already-equal flag.
- Do not invoke the rule engine or ETag workflow for this minimal internal
  metadata update.
- Compare source IDs through `canonicalize_id` because persisted IDs can
  include or omit hyphens.
- Keep pure translation helpers importable without loading the complete agent
  stack.

## QA

- Python compilation and translation-helper tests pass.
- Frontend build passes.
- Browser QA verifies row action, context-aware mode, idempotent update, bulk
  translation, and stale-state display.

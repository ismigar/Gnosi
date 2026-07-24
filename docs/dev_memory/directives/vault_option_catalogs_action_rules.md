# Option Catalogs and Action Rules

> Status: phases 1–3 implemented on 2026-06-12. Run the registry migration
> after merge. The optional UI action-rule editor is still pending.

## Objective

Provide managed option catalogs for language, status, and tags; identify those
fields by semantic role; and make translation, Drupal synchronization, and
social publishing respect and update lifecycle state.

## Data model

- `select`, `multi_select`, and `status` remain the only option field types.
- Options use rich objects such as
  `{ "id": "opt_*", "name": "Draft", "color": "gray" }`.
- Readers normalize legacy string arrays in memory.
- Writers persist only the rich format.
- `status` adds groups and a default option.
- `multi_select` plus a catalog is the tags model; no separate tags type is
  required.
- Language uses `select` with `config.role: "language"`.
- Status uses `config.role: "status"`.
- Tags use `config.role: "tags"`.
- Shared named catalogs live in top-level `option_catalogs` and fields refer to
  them through `config.catalog_ref`.

Semantic roles take precedence over localized-name heuristics. Name heuristics
remain a migration fallback and must be restricted to compatible field types.

Per-table `action_rules` use this shape:

```json
{
  "action": "translate_row",
  "requires": [
    {
      "role": "status",
      "op": "not_in",
      "values": ["Draft"],
      "reason": "Review the source before translating it."
    }
  ],
  "on_success": {
    "source": {"status": "Translated"},
    "created": {"status": "Draft"}
  },
  "on_stale": {"created": {"status": "Draft"}}
}
```

The registry stores normalized canonical values. User-visible labels belong in
i18n resources.

## Default status catalog

Every semantic status field contains:

- `Draft` in the initial group.
- `Reviewed` in the in-progress group.
- `Translated` in the in-progress group for translatable tables.
- `Published to Drupal` in the final group when Drupal sync is enabled.
- `Published to Social Media` in the final group when social publishing is
  enabled.

New or stale translations return to `Draft`; the user moves them to
`Reviewed` after review.

## Action behavior

### Translation

The frontend keeps the Translate action visible but disabled when a
requirement fails and shows the rule's reason in a tooltip. The backend
revalidates every requirement and returns HTTP `409` with the reason.

Bulk translation skips blocked rows and returns a per-row reason rather than
aborting the batch.

On success:

- The source becomes `Translated`.
- Every created or updated translation becomes `Draft`.
- The target language is assigned as before.

When `_propagate_translation_staleness` marks a child stale, `on_stale` also
returns it to `Draft`.

If an effect references a missing catalog option, the engine creates the
option with an automatic color and logs the repair. An incomplete catalog must
not break an action.

### Drupal and social publishing

Publishing uses the same requirement and effect engine. A successful Drupal
sync changes the source status to `Published to Drupal`; successful social
publishing changes it to `Published to Social Media`. Because status is a
single value, the latest successful action wins. Provider-specific metadata
retains the full operational history.

The Social Publications table keeps its own independent lifecycle.

## Catalog management

The options editor supports color, status group, default option, reordering,
and usage count.

Renaming an option rewrites affected Markdown values eagerly. Removing an
option in use requires either clearing it or reassigning it to another option.
The backend performs atomic writes and returns the number of changed files.

Shared catalogs currently reject rename and delete because a per-table rewrite
cannot safely cover every consumer. Adding, recoloring, and reordering shared
options are supported.

The UI must warn before removing an option referenced by an action rule.

## Migration

`pipeline/scripts/migrate_option_catalogs.py` is idempotent, uses dry-run by
default, and applies changes only with `--apply`.

Run it only after the new reader and writer have merged:

1. Create a dated registry backup.
2. Derive missing catalogs from existing values, ordered by frequency.
3. Assign semantic roles to compatible language, status, and tags fields.
4. Seed the applicable default status options.
5. Seed translation, Drupal, and social action rules for enabled features.
6. Leave frontmatter untouched because stored option names do not change.

Existing values are merged into the catalog and never discarded. Reverting the
registry type and configuration reverses the schema migration.

## Implementation lessons

- Do not resolve a page by ID immediately after creating a translation. The
  page index may be refreshing. Write the known source `file_path` through
  `_write_metadata_key_on_disk`.
- Translation staleness must compare translatable fields by ID, name, and
  alias because frontmatter stores names.
- Localized-name role inference applies only to compatible option field types;
  an unrelated text field named “Status” is not a semantic status field.
- `buildPayload` must round-trip unknown configuration keys such as `role`,
  `option_groups`, `catalog_ref`, and future extensions.
- Backend schema upserts must preserve property aliases.
- Rows live under `BD/<database name>/<folder>`, not at the vault root.
- A migration rerun must merge missing values without removing prior options.
- Isolated E2E tests use a temporary vault and local-data directory. Never
  reuse a persisted page-index cache with a recreated vault.

## Restrictions

- Catalog rewrites can touch many OneDrive files. Use backend atomic writes and
  do not combine them with another mass migration on the same day.
- Action rules are not a second automation trigger system.
- Translation rows identified by `translation_lang` still do not expose the
  Translate action.
- A second Mac with old code must not crash when it sees the rich registry
  format. Deploy the tolerant reader with the first rich write.
- Option names are stored values. Renaming them is a data migration, not a
  cosmetic label change.

## QA gates

1. Frontend build and backend tests pass.
2. A Draft source shows a disabled Translate action and the backend returns
   `409` for a direct request.
3. A Reviewed source translates successfully; the source becomes Translated
   and the child becomes Draft.
4. Editing the source marks the child stale and returns it to Draft.
5. Removing an option with reassignment changes the expected number of files
   and leaves no stale value.
6. A legacy string catalog loads without data loss.
7. Browser QA covers the disabled-action tooltip and catalog editor.

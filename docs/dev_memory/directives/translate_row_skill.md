# Row Translation Skill

## Summary

The `translate_row` skill allows a table and selected fields to be marked
translatable. A row action opens target-language selection and creates or
updates child rows containing translated field values.

## Configuration

Table:

- `translation_enabled`

Properties:

- `type: "button"` for the action.
- `button_action: "translate_row"`.
- Optional localized `button_label`.
- `translatable: true` for supported source fields.

User-visible labels are i18n keys with English defaults.

## Created translation

Each translation:

- Uses the source row as `parent_id`.
- Retains the table ID and folder.
- Stores translated values under canonical current property names.
- Records target language, detected source language, source row ID, and
  provider.

Persisted metadata identifiers remain stable compatibility keys. Do not
reintroduce opaque field IDs into Markdown; follow
`vault_persist_by_name.md`.

## Providers

Provider selection supports free public or local translation paths and an
optional configured DeepL fallback. Protect acronyms before providers known to
alter them, then restore them after translation.

Local models load lazily and unload after an idle timeout. Model caches belong
outside OneDrive.

Do not assume any third-party public endpoint is permanently available.
Provider errors must produce a clear per-language result and preserve source
data.

## Restrictions

- Skip a target equal to the source language.
- Skip a target when no translatable field has content.
- Button, formula, rollup, virtual, and other derived fields are not
  translatable.
- Backend orchestration uses the pure skill function directly; it does not
  launch a subprocess that imports backend internals.
- Store arrays and structured fields without string coercion.
- Preserve the user's selected content language.
- Action-rule status requirements and effects are specified in
  `vault_option_catalogs_action_rules.md`.

## Activation

1. Enable translation for the table.
2. Mark eligible text fields translatable.
3. Add a button property whose action is `translate_row`.
4. Save and invoke the action from a disposable test row.

## QA

1. Unit-test provider selection, acronym protection, and fallback behavior.
2. Translate a disposable row to multiple targets.
3. Verify parent/table identity, canonical property names, language metadata,
   status effects, and persistence after restart.
4. Test same-language skip, empty fields, provider failure, and retry.
5. Browser-test modal labels and progress in English and another selected
   locale.

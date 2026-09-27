---
name: translate-row
description: Translate configured table-row fields and Markdown into language children, updating existing translations in place. Use for the explicit translate-row action or maintenance of its provider adapters.
metadata:
  status: active
---

# Skill: translate_row

## Purpose

Given a table row whose table has `translation_enabled: true`, translate every
field marked `translatable: true` in the table's `properties` into the
user-selected languages. Create or update one child with `parent_id = item_id`
per language; translate the Markdown body when its adapter is available.

## Trigger

The UI invokes this workflow when the user activates a `button` field whose
`button_action` is `translate_row`. `TranslateLanguagesModal` sends:

```
POST /api/vault/skills/translate-row
Body: { item_id: str, target_languages: [str], button_action: "translate_row" }
```

## Architecture

The endpoint in `backend/domains/vault/translation/routes.py` delegates through
the domain lifecycle to `row_service.py`; the historical route facade remains
compatible. The service coordinates the operation:

- Load `item_id` from the registry and identify its table and schema.
- Select fields with `translatable: true`.
- Request each target-language translation from this skill.
- Create or update a child through the page write service with `parent_id`,
  `metadata.translation_origin_id` and `metadata.translation_lang`. Existing
  language children are updated instead of duplicated.

The skill implementation in `scripts/translate_text.py` exposes:

- `translate(text, source_lang, target_lang, ...) -> (translated_text, provider)`
- `detect_source_lang(text) -> str`

The backend imports the skill lazily through the translation adapter. Preserve
that callable contract instead of introducing a subprocess for every field.

## Translation profile and configuration

All language pairs call `backend.services.agent_execution.generate_for("translation", ...)`
with the `core.gnosi-translation-workflow` skill. Standalone UI actions use the
editable profile owned by `builtin:translation` (default ID
`builtin.translation.default`). Nested actions inherit the running agent's
snapshot and must have the translation skill assigned.

Configure the model in the Translation plugin's profile and connect its AI
provider. Execution applies that profile's model policy, budgets and activity
tracking. A newly created plugin profile initially copies the principal's
provider and model; later principal changes do not overwrite the plugin profile.

DeepL, Softcatalà, Apertium and OPUS-MT routing has been retired. The historic
`deepl_api_key` and `softcatala_url` keyword arguments remain accepted for caller
compatibility but are ignored. Existing saved credentials are preserved. There
is no provider-specific environment configuration or placeholder fallback in
`translate_text.py`. Its `principal_agent` provider label is a legacy marker for
the shared executor; the activity record identifies the actual profile and model.

The skill-instruction reading translation also uses this operation, through
`/api/ai/generate` with `mode="translate_instructions"`. It treats the supplied
instructions as text, preserves protected literals and leaves the original skill
unchanged. Failed calls remain retryable.

Tests must fake the executor. Live translation can send the selected text to the
configured AI provider and incur usage costs.

## Restrictions and edge cases

- Provider or profile failures propagate from the translation callable; no fake
  `[<lang>] ...` translation is returned.
- Skip a target identical to the detected source language.
- Skip empty fields. Skip a language child when both translated fields and
  translated Markdown are empty.
- A field translator exception becomes `[error: <message>]` with provider
  `error`; the row service does not add a retry. A Markdown exception retains
  the original body; an unavailable Markdown adapter produces no translated body.
- Return HTTP 400 when the schema has no translatable fields.
- Preserve the existing single-row and batch routes; the single-row modal is
  not evidence that batch translation is unavailable.
## Child item shape

```json
{
  "title": "<translated title>",
  "parent_id": "<item_id>",
  "metadata": {
    "table_id": "<parent row table id>",
    "database_table_id": "<parent row table id>",
    "translation_lang": "<ISO 639-1 code>",
    "translation_source_lang": "<source language>",
    "translation_origin_id": "<item_id>",
    "translation_stale": false,
    "translation_provider": "<provider or mixed>",
    "<translatable_field_1>": "<translation>",
    "<translatable_field_2>": "<translation>"
  }
}
```

Use the translated title when configured. Otherwise use the first translated
text/rich-text field, limited to 120 characters, or the parent title plus language.
Keep response groups `created`, `updated`, and `skipped` distinct.

## Explicit live invocation

Use the Translate row action in an open Vault. The shared executor requires an
authenticated Vault execution scope; running the historic command-line wrapper
without that scope does not establish one. Live translation sends the supplied
text to the configured provider and can incur usage costs.

For offline verification, run the synthetic translation tests:

```bash
python3 -m pytest backend/tests/test_translate_row_skill.py
```

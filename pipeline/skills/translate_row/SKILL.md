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

## Translation providers

The existing provider routing is shown below. This describes implementation
choices, not a live availability or translation-quality certification. Tests
must inject fake providers; real translation requires the user's requested
operation and can transmit selected text to external services.

| Pair | Provider | Runtime | Quality |
|------|----------|---------|---------|
| `en↔ca` | Softcatalà NMT | public online service | neural |
| `ca↔{es, fr, it, pt, ro, oc, …}` | Softcatalà Apertium plus acronym protection | public online service | rule-based |
| `es↔fr`, `fr↔es` | OPUS-MT (Helsinki-NLP) | local, loaded lazily | neural |
| Other non-Catalan pairs, such as `es↔en` | Apertium APy plus acronym protection | public online service | rule-based |
| Fallback | DeepL | online, when configured | neural |
| Last resort | `[lang] {text}` placeholder | local | visible fallback |

The implementation's default public endpoints (no key is passed by these adapters):

- Softcatalà NMT:
  `https://www.softcatala.org/sc/v2/api/nmt-engcat/translate`
- Softcatalà Apertium:
  `https://www.softcatala.org/apertium/json/translate`
- Apertium APy: `https://apertium.org/apy/translate`

### Why local OPUS-MT is limited to `es↔fr`

The routing reserves OPUS-MT for this pair based on earlier observed translation
quality. Do not expand model loading or change routing during a structural
refactor; measure quality separately if the user requests a provider change.

Models:

- `Helsinki-NLP/opus-mt-es-fr`
- `Helsinki-NLP/opus-mt-fr-es`

### Acronym protection

Apertium translates uppercase acronyms as ordinary words, for example
`API` to a food name, or lowercases `JSON`. Before calling Apertium, wrap
`[A-Z][A-Z0-9-]{1,5}` acronyms in neutral `XACRN###ZZZ` tokens and restore
them afterward.

## OPUS-MT memory and cache

- The module does not preload a model; models are loaded on first use. Memory
  use depends on the runtime and loaded model, so do not promise zero process
  memory or a fixed amount per direction.
- Auto-unload: `_purge_idle_opus` unloads a model on the next call after
  `OPUS_IDLE_TIMEOUT_S`, default 300 seconds, without use.
- Disk: Hugging Face cache under `$HF_HOME` or `~/.cache/huggingface/`.
  Keep caches on local per-device storage, outside synchronized vault folders.
  Loading time depends on download state and the machine.

## Environment

All defaults are public. Optional variables:

```bash
DEEPL_API_KEY=<key>            # only for pairs not adequately covered elsewhere
DEEPL_API_URL=...              # override the DeepL endpoint
SOFTCATALA_API_URL=...         # override both Softcatalà endpoints
APERTIUM_PUBLIC_API_URL=...    # override Apertium APy
OPUS_IDLE_TIMEOUT_S=300        # idle seconds before local model unload
HF_HOME=${HOME}/.cache/huggingface  # local per-device model cache
```

UI-managed DeepL keys use the system secret-store adapter through Settings.
The callable also supports an explicit key and an environment fallback; do not
write to a shared environment file from the application.

## Restrictions and edge cases

- Missing optional credentials retain the existing visible `[<lang>] ...`
  fallback. A placeholder proves fallback behavior, not a successful translation.
- Skip a target identical to the detected source language.
- Skip empty fields. Skip a language child when both translated fields and
  translated Markdown are empty.
- A field translator exception becomes `[error: <message>]` with provider
  `error`; the row service does not add a retry. A Markdown exception retains
  the original body; an unavailable Markdown adapter produces no translated body.
- Return HTTP 400 when the schema has no translatable fields.
- Preserve the existing single-row and batch routes; the single-row modal is
  not evidence that batch translation is unavailable.
- Treat Softcatalà, Apertium and DeepL response bodies as unknown objects and
  narrow their envelope before reading translated text.
- Keep cached OPUS-MT entries behind the minimal tokenizer/model protocols in
  `translate_text.py`. Do not type the cache as generic `object` or leak
  Transformers' incomplete concrete generics into translation routing.
- Note: Do not add translation routing fixtures without running Ruff formatting
  on the exact test file; multiline response envelopes may be collapsed by the
  formatter even when lint and behavior already pass.

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

This sends the supplied text to the selected provider; it is not an offline QA
check. For structural changes, run synthetic backend translation tests instead.

```bash
cd Gnosi
python3 -m pipeline.skills.translate_row.scripts.translate_text \
    --text "Hello, how are you?" --source en --target ca
```

---
name: translate_row
description: Translate the translatable fields of a table row and create one child item per target language.
type: skill
status: active
---

# Skill: translate_row

## Purpose

Given a table row whose table has `translation_enabled: true`, translate every
field marked `translatable: true` in `_config` into the user-selected
languages. Create one child item with `parent_id = item_id` per language.

## Trigger

The UI invokes this workflow when the user activates a `button` field whose
`button_action` is `translate_row`. `TranslateLanguagesModal` sends:

```
POST /api/vault/skills/translate-row
Body: { item_id: str, target_languages: [str], button_action: "translate_row" }
```

## Architecture

The endpoint in `backend/api/vault_routes.py` coordinates the operation:

- Load `item_id` from the registry and identify its table and schema.
- Select fields with `translatable: true`.
- Request each target-language translation from this skill.
- Create a child item through `POST /pages` with `parent_id` and
  `metadata.translation_lang`.

The skill implementation in `scripts/translate_text.py` exposes:

- `translate(text, source_lang, target_lang) -> str`
- `detect_source_lang(text) -> str`

The backend imports the skill directly. Do not invoke it as a subprocess:
coordination needs registry access, while Gnosi's sandbox cannot import
`backend.*`.

## Translation providers

Use free services where quality is sufficient, with a local model for the
specific `es↔fr` weakness.

| Pair | Provider | Runtime | Quality |
|------|----------|---------|---------|
| `en↔ca` | Softcatalà NMT | public online service | neural |
| `ca↔{es, fr, it, pt, ro, oc, …}` | Softcatalà Apertium plus acronym protection | public online service | rule-based |
| `es↔fr`, `fr↔es` | OPUS-MT (Helsinki-NLP) | local, loaded lazily | neural |
| Other non-Catalan pairs, such as `es↔en` | Apertium APy plus acronym protection | public online service | rule-based |
| Fallback | DeepL | online, when configured | neural |
| Last resort | `[lang] {text}` placeholder | local | visible fallback |

Public endpoints that require no API key:

- Softcatalà NMT:
  `https://www.softcatala.org/sc/v2/api/nmt-engcat/translate`
- Softcatalà Apertium:
  `https://www.softcatala.org/apertium/json/translate`
- Apertium APy: `https://apertium.org/apy/translate`

These endpoints were identified from Softcatalà's official Android client,
[TraductorSoftcatalaAndroid](https://github.com/Softcatala/TraductorSoftcatalaAndroid).

### Why local OPUS-MT is limited to `es↔fr`

Public Apertium produces severe grammatical errors and untranslated words for
Spanish/French. No free remote provider in this routing table handles the pair
well. Loading one approximately 300 MB OPUS-MT model on demand provides neural
quality with no idle memory cost.

Models:

- `Helsinki-NLP/opus-mt-es-fr`
- `Helsinki-NLP/opus-mt-fr-es`

### Acronym protection

Apertium translates uppercase acronyms as ordinary words, for example
`API` to a food name, or lowercases `JSON`. Before calling Apertium, wrap
`[A-Z][A-Z0-9-]{1,5}` acronyms in neutral `XACRN###ZZZ` tokens and restore
them afterward.

## OPUS-MT memory and cache

- Idle memory: zero; the model is not loaded.
- Translation memory: approximately 300–500 MB per direction.
- Auto-unload: `_purge_idle_opus` unloads a model on the next call after
  `OPUS_IDLE_TIMEOUT_S`, default 300 seconds, without use.
- Disk: Hugging Face cache under `$HF_HOME` or `~/.cache/huggingface/`.
  Keep it outside OneDrive. The first load takes about 20 seconds; later loads
  are usually under one second.

## Environment

All defaults are public. Optional variables:

```bash
DEEPL_API_KEY=<key>            # only for pairs not adequately covered elsewhere
DEEPL_API_URL=...              # override the DeepL endpoint
SOFTCATALA_API_URL=...         # override both Softcatalà endpoints
APERTIUM_PUBLIC_API_URL=...    # override Apertium APy
OPUS_IDLE_TIMEOUT_S=300        # idle seconds before local model unload
HF_HOME=${HOME}/.cache/huggingface  # model cache outside OneDrive
```

Store the DeepL key in Keychain through the Translation tab in Settings, not
in `.env_shared`.

## Restrictions and edge cases

- Missing optional credentials must not break the workflow. Return a visible
  `[<lang>] ...` placeholder so the end-to-end flow can be tested first.
- Skip a target identical to the detected source language.
- Skip empty fields. Do not create a language child when every translatable
  field is empty.
- Retry transient errors once with backoff. If the retry fails, write
  `[error: <message>]` to the child field.
- Return HTTP 400 when the schema has no translatable fields.
- The modal translates one row per request. Whole-table translation requires
  a separate future tool.

## Child item shape

```json
{
  "title": "<translated title>",
  "parent_id": "<item_id>",
  "metadata": {
    "table_id": "<parent row table id>",
    "translation_lang": "<ISO 639-1 code>",
    "translation_source": "softcatala | deepl | placeholder",
    "<translatable_field_1>": "<translation>",
    "<translatable_field_2>": "<translation>"
  }
}
```

Use the translated `title` field as the title. If it is not translatable, use
the first translatable field.

## Quick test

```bash
cd monorepo/apps/gnosi
python3 -m pipeline.skills.translate_row.scripts.translate_text \
    --text "Hello, how are you?" --source en --target ca
```

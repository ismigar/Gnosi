---
name: translate_row
description: Tradueix els camps marcats com a traduïbles d'una fila d'una taula i crea un subitem per cada idioma destí.
type: skill
status: active
---

# Skill: translate_row

## Propòsit

Donada una fila (`page`) d'una taula amb el flag `translation_enabled: true`, tradueix
els camps marcats amb `translatable: true` al seu `_config` cap als idiomes destí
indicats per l'usuari, i crea un subitem (`parent_id = item_id`) per cada idioma.

## Disparador

Disparada per la UI quan l'usuari clica un camp de tipus `button` amb
`button_action = "translate_row"`. El frontend obre el modal
`TranslateLanguagesModal` i fa POST a:

```
POST /api/vault/skills/translate-row
Body: { item_id: str, target_languages: [str], button_action: "translate_row" }
```

## Arquitectura

L'**endpoint** (a `backend/api/vault_routes.py`) fa la coordinació:
- Llegeix `item_id` del registry, identifica la taula i el seu schema.
- Filtra camps amb `translatable: true`.
- Per cada idioma destí, demana la traducció a aquesta skill.
- Crea un subitem (`POST /pages` amb `parent_id` i `metadata.translation_lang`).

La **skill** (`scripts/translate_text.py`) només exposa:
- `translate(text, source_lang, target_lang) -> str`: ruta el text al proveïdor adequat.
- `detect_source_lang(text) -> str`: detecció heurística de l'idioma origen.

L'usuari NO ha d'invocar la skill com a subprocess — el backend la importa
directament. Aquesta separació és perquè la lògica de coordinació necessita
accés al registry, i `subprocess` no pot importar `backend.*` (limitació del
sandbox de Gnosi).

## Proveïdors de traducció (routing Mid)

Estratègia: eines lliures sempre que la qualitat sigui acceptable; locals
només quan la qualitat remota cau (cas concret: `es↔fr`).

| Parell | Proveïdor | On corre | Qualitat |
|--------|-----------|----------|----------|
| `en↔ca` | Softcatalà NMT | Online (públic) | ★★★★★ Neural |
| `ca↔{es, fr, it, pt, ro, oc, …}` | Softcatalà Apertium + acronym fix | Online (públic) | ★★★½ |
| `es↔fr`, `fr↔es` | **OPUS-MT (Helsinki-NLP)** | **Local, lazy** | ★★★★ Neural |
| Altres parells sense `ca` (p.ex. `es↔en`) | Apertium APy + acronym fix | Online (públic) | ★★★ |
| Fallback | DeepL | Online | ★★★★½ (si key configurada) |
| Últim recurs | placeholder `[lang] {text}` | — | — |

### Endpoints públics (cap requereix API key)

- Softcatalà NMT: `https://www.softcatala.org/sc/v2/api/nmt-engcat/translate`
- Softcatalà Apertium: `https://www.softcatala.org/apertium/json/translate`
- Apertium APy: `https://apertium.org/apy/translate`

Identificats inspeccionant el codi del client Android oficial de Softcatalà
([TraductorSoftcatalaAndroid](https://github.com/Softcatala/TraductorSoftcatalaAndroid)).

### Per què OPUS-MT just per `es↔fr`

Apertium públic en `spa↔fra` produeix errors gramaticals greus
("dirigeante" en lloc de "directive"; "il y a que" per "il faut") i deixa
paraules sense traduir. Cap proveïdor remot lliure cobreix bé aquest
parell. Carregar un sol model OPUS-MT (~300 MB) sota demanda és el
compromís: zero RAM en repòs, qualitat NMT al moment de traduir.

Models usats:
- `Helsinki-NLP/opus-mt-es-fr`
- `Helsinki-NLP/opus-mt-fr-es`

### Acronym fix (Apertium pre-processor)

Apertium tradueix paraules en MAJÚSCULES com a noms comuns: "API"→"apio"
(es) o "céleri" (fr); "JSON"→"json" minúscula. La skill aplica un
pre/post-processor que envolta acrònims (`[A-Z][A-Z0-9-]{1,5}`) amb tokens
neutres `XACRN###ZZZ` abans de cridar Apertium i els restaura després.
Cap canvi visible per a l'usuari, però evita el bug d'acrònims.

## Memòria i caché del model OPUS-MT

- **En repòs**: 0 MB (no carregat).
- **Durant traducció**: ~300-500 MB per model (un per direcció).
- **Auto-unload**: passat `OPUS_IDLE_TIMEOUT_S` (default 300 s = 5 min) sense
  ús, el model es descarrega en la propera crida que faci `_purge_idle_opus`.
- **Disc**: HuggingFace cache (`$HF_HOME` o `~/.cache/huggingface/`). Cal que
  estigui **fora d'OneDrive** (vegeu `feedback_cache_outside_onedrive`).
  Primera càrrega: ~20 s (descàrrega + inicialització). Següent: <1 s.

## Configuració d'entorn

Tots els defaults són públics. Variables opcionals:

```bash
# Translate row skill — totes opcionals
DEEPL_API_KEY=<key>            # https://www.deepl.com/pro-api — només per parells sense català coberts per Apertium
DEEPL_API_URL=...              # override DeepL endpoint
SOFTCATALA_API_URL=...         # override d'AMBDÓS endpoints de Softcatalà (NMT i Apertium)
APERTIUM_PUBLIC_API_URL=...    # override d'Apertium APy
OPUS_IDLE_TIMEOUT_S=300        # segons d'inactivitat abans de descarregar el model OPUS-MT
HF_HOME=${HOME}/.cache/huggingface  # ubicació del cache de models (FORA d'OneDrive!)
```

La key de DeepL es desa al **Keychain** (no a `.env_shared`) via la pestanya
"Traducció" del modal de Settings (`/api/credentials/`).

## Edge cases / Restricciones

- **Sense credencials → no failure**: si `DEEPL_API_KEY` no està configurada, la
  skill retorna text amb prefix `[<lang>] ...` com a placeholder visible. Així
  l'usuari pot validar el flux end-to-end abans de configurar les keys.
- **Idioma origen igual al destí**: skip — no es genera subitem.
- **Camp buit**: skip el camp; si tots els camps traduïbles estan buits, no es
  crea el subitem per aquell idioma.
- **Errors transitoris**: 1 reintent amb backoff. Si segueix fallant, marca el
  camp del subitem com `[error: <missatge>]` perquè l'usuari ho vegi.
- **No hi ha camps traduïbles**: l'endpoint retorna 400 — la UI hauria d'haver
  filtrat aquest cas, però defensem.
- **Càrrega massiva**: el modal limita a una fila per crida. Per traduir taules
  senceres cal una eina diferent (no creada).

## Estructura del subitem creat

```json
{
  "title": "<títol traduït>",
  "parent_id": "<item_id>",
  "metadata": {
    "table_id": "<mateix de la fila pare>",
    "translation_lang": "<codi ISO 639-1>",
    "translation_source": "softcatala" | "deepl" | "placeholder",
    "<camp_traduible_1>": "<traducció>",
    "<camp_traduible_2>": "<traducció>",
    ...
  }
}
```

El títol és la traducció del camp `title` (o del primer camp traduïble si el
títol no és traduïble).

## Test ràpid

```bash
cd /Users/ismaelgarciafernandez/Projectes/monorepo/apps/gnosi
python3 -m pipeline.skills.translate_row.scripts.translate_text \
    --text "Hola, com estàs?" --source ca --target en
```

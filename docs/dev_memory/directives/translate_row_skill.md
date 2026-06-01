# Directiva: traducció de files via botó (skill `translate_row`)

## Resum

Permet marcar una **taula** com a traduïble i un o més **camps** com a traduïbles.
S'afegeix un nou tipus de camp `button` que, en clicar-lo, demana els idiomes
destí i crea un subitem (parent_id = fila origen) per cada idioma amb les
traduccions dels camps marcats.

## Components

| Capa | Fitxer | Rol |
|------|--------|-----|
| Frontend | `frontend/src/components/Vault/SchemaConfigModal.jsx` | Toggle de taula traduïble + per camp + tipus `button` |
| Frontend | `frontend/src/components/Vault/TranslateLanguagesModal.jsx` | Modal de selecció d'idiomes destí |
| Frontend | `frontend/src/components/Vault/VaultTable.jsx` | Render de la cel·la `button` i obertura del modal |
| Frontend | `frontend/src/components/Vault/schemaUtils.js` | Persistència de `translatable`, `button_action`, `button_label` |
| Frontend | `frontend/src/pages/VaultDashboard.jsx` | Persisteix `translation_enabled` a la taula |
| Backend | `backend/api/vault_routes.py` (`POST /api/vault/skills/translate-row`) | Coordina lectura, traducció i creació de subitems |
| Skill | `pipeline/skills/translate_row/SKILL.md` | Documentació de la skill |
| Skill | `pipeline/skills/translate_row/scripts/translate_text.py` | `translate(text, src, tgt) -> (str, provider)` |

## Persistència

- **A la taula** (`registry.tables[i]`): `translation_enabled: true|false`
- **A cada propietat** (`registry.tables[i].properties[j]`):
  - `type: "button"` per als camps d'acció
  - `button_action: "translate_row"` (per ara l'única acció)
  - `button_label: "..."` (text mostrat al botó; opcional)
  - `translatable: true` per a camps que el botó ha de traduir

## Subitem creat

Cada subitem té `parent_id` = id de la fila origen i hereta `table_id` perquè
es desa a la mateixa carpeta. Els camps traduïts es persisteixen amb la
**mateixa clau** que el pare (preferint `field_id` estable). Metadades
addicionals:

- `translation_lang`: codi ISO 639-1 (`en`, `es`, `fr`, ...)
- `translation_source_lang`: idioma origen detectat
- `translation_origin_id`: `id` de la fila pare (redundant amb `parent_id`,
  però explícit per filtres)
- `translation_provider`: `softcatala` | `deepl` | `placeholder` | `mixed`

## Proveïdors (Mid plan — eines lliures per defecte)

| Parell | Proveïdor | On |
|--------|-----------|------|
| `en↔ca` | Softcatalà NMT | Online (públic, gratis) |
| `ca↔{es, fr, …}` | Softcatalà Apertium + acronym-fix | Online (públic, gratis) |
| `es↔fr`, `fr↔es` | OPUS-MT (`Helsinki-NLP/opus-mt-{es-fr,fr-es}`) | **Local, lazy** |
| Altres pairs sense `ca` | Apertium APy + acronym-fix | Online (públic, gratis) |
| Fallback opcional | DeepL | Online (necessita key) |

**Acronym fix**: pre/post-processor que protegeix `[A-Z][A-Z0-9-]{1,5}` amb
tokens `XACRN###ZZZ`. Aplica només a Apertium (no NMT — ja preserva). Soluciona
"API→apio/céleri", "JSON→json", etc.

**OPUS-MT lazy**: el model no es carrega fins la primera crida `es↔fr`.
Una vegada carregat, queda en memòria fins que passa `OPUS_IDLE_TIMEOUT_S`
(default 5 min) sense ús, llavors s'allibera. RAM en repòs = 0; pic durant
ús = ~300-500 MB per model (es-fr i fr-es per separat).

**Sense cap configuració**, els 5 primers parells funcionen out-of-the-box
gràcies als endpoints públics i el model local. DeepL només cal si
necessites parells sense català que Apertium no cobreix bé.

## Restriccions / Edge cases apresos

- **Idioma origen igual al destí** → skip (no es genera subitem).
- **Cap camp traduïble amb contingut** → skip aquell idioma.
- **Camp tipus `button`** no és mai traduïble (sense valor textual).
- **Camps derivats** (formula/rollup/virtual) no apareixen com a traduïbles.
- **Subprocess no pot importar `backend.*`** → la coordinació viu a l'endpoint
  i només la funció pura `translate(...)` viu a la skill (importada
  directament pel backend, sense subprocess).
- **`get_table_id`** llegeix tant `database_table_id` (preferit) com
  `table_id` (legacy). Per al subitem escrivim totes dues.
- **Resolució `id` vs `name`**: les metadades del Vault s'escriuen per
  `field_id` (`fld_xxxxxxxx`) preferentment; en llegir provem `id` primer i
  després `name`. Per als subitems escrivim per `id` perquè el pare l'usa.

## Activació

1. Edita el schema de la taula → activa "Taula traduïble". Subitems s'activa
   automàticament la primera vegada (necessari per la jerarquia).
2. Per cada camp textual rellevant, marca "Traduïble".
3. Afegeix una nova propietat de tipus "Botó", deixa l'acció a "Traduir fila"
   i posa-li una etiqueta (per defecte: "Traduir").
4. Desa. A la fila apareixerà el botó; en clicar-lo s'obre el modal d'idiomes.

## Configuració d'entorn

A `.env_shared` (totes opcionals):

```bash
# DEEPL_API_KEY=xxxx                # https://www.deepl.com/pro-api (al Keychain via Settings; també llegit de l'env)
# DEEPL_API_URL=...                 # override DeepL endpoint
# SOFTCATALA_API_URL=...            # override Softcatalà NMT i Apertium
# APERTIUM_PUBLIC_API_URL=...       # override apertium.org/apy
# OPUS_IDLE_TIMEOUT_S=300           # segons d'inactivitat abans d'unload OPUS-MT
# HF_HOME=${HOME}/.cache/huggingface  # cache models — FORA d'OneDrive (regla de caches)
```

Després de canvis al `.env_shared`, reinicia el backend (`docker-compose restart`)
perquè els llegeixi.

## Dependencies addicionals

`requirements.txt` afegeix `sentencepiece` (necessari per Marian/OPUS-MT).
`torch` i `transformers` ja venen transitivament via `sentence-transformers`,
així que no cal afegir-los explícitament. La primera crida `es↔fr` triga
~20 s (descàrrega del model ~300 MB de HuggingFace); les següents són <1 s.

## Test ràpid

```bash
# Test directe de la funció de traducció
cd ~/Projectes/monorepo/apps/gnosi
python3 -m pipeline.skills.translate_row.scripts.translate_text \
    --text "Hola, com estàs?" --source ca --target en
```

```bash
# Test de l'endpoint (assumint backend a localhost:5002)
curl -X POST http://localhost:5002/api/vault/skills/translate-row \
  -H 'Content-Type: application/json' \
  -d '{"item_id":"<UUID>", "target_languages":["en","es"], "button_action":"translate_row"}'
```

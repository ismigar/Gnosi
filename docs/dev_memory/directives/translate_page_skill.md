# Directiva: traducció de pàgines senceres (skill `translate_page`)

## Resum

Permet traduir una **pàgina del Vault** (document markdown `.md`) a un o més idiomes.
En clicar «Tradueix la pàgina» al menú d'opcions de pàgina, es demana els idiomes destí
i es crea una **subpàgina filla** (`parent_id` = pàgina origen) per cada idioma amb el
**títol i el cos traduïts**. Mateix patró que [translate_row_skill.md](translate_row_skill.md),
però sobre el body markdown sencer en lloc de camps de fila.

**Abast:** només pàgines del Vault (markdown). Els PDFs del reader queden **fora** (no hi
ha extracció de text al backend). Vegeu [environment_integrity.md](environment_integrity.md).

## Components

| Capa | Fitxer | Rol |
|------|--------|-----|
| Skill | `pipeline/skills/translate_page/scripts/markdown_segmenter.py` | `translate_markdown()` / `translate_title()` — segmenta i tradueix preservant estructura |
| Skill | `pipeline/skills/translate_page/SKILL.md` | Documentació de la skill |
| Backend | `backend/api/vault_routes.py` (`POST /api/vault/skills/translate-page`) | Coordina lectura, traducció i creació de subpàgines |
| Frontend | `frontend/src/components/Vault/TranslateLanguagesModal.jsx` | Modal d'idiomes (generalitzat: `mode` `row`/`page`) |
| Frontend | `frontend/src/components/Vault/VaultShell.jsx` | Botó «Tradueix la pàgina» al menú d'opcions |
| Frontend | `frontend/src/pages/VaultDashboard.jsx` | Capability, estat del modal i refresc de l'arbre |

## Reutilització

La funció pura de traducció **es reutilitza tal qual** de `translate_row`:
`translate(text, src, tgt, *, deepl_api_key, softcatala_url) -> (str, provider)` i
`detect_source_lang(text)` de
`pipeline/skills/translate_row/scripts/translate_text.py`. El segmentador també
reutilitza `_protect_acronyms`/`_restore_acronyms` d'allà. `translate_text.py` resta
**agnòstic de markdown** (és infraestructura de proveïdors); tota la lògica de markdown
viu a `markdown_segmenter.py`.

## Contracte del segmentador (CRÍTIC)

El body és **markdown enriquit**; la gramàtica canònica viu a
`frontend/src/components/Vault/markdown-mapper.js`. El segmentador n'és el mirall en
Python: el markdown traduït **s'ha de poder re-parsejar amb `richMarkdownToBlocks` sense
trencar-se**. Processament **línia a línia amb màquina d'estats de bloc**.

### Passthrough verbatim (NO es tradueix mai)

- **Fences de codi** ` ```lang … ``` ` i `~~~` (es casa caràcter i llargada d'obertura).
  Cobreix ` ```gnosi-database ` i ` ```gnosi-view ` → el seu JSON queda intacte perquè
  viu dins del fence.
- **Línies de directiva** `^(:{3,})(column-list|column|toggle|gnosi-ignore)(.*)$` i el
  tancament `:::`. Dins de `:::gnosi-ignore … :::`, saltar-ho tot.
- **Bibliografia** en línia pròpia `{{bibliography}}` / `{{bibliography:apa}}` /
  `{{bibliography:apa:ca-AD}}` (regex estricte `^\{\{bibliography(...)?\}\}$`).
- **Transclusió** en línia pròpia `![[target#section|alias]]`: `target`/`section` NO es
  tradueixen.
- **Regla horitzontal** `---`, separador de taula `|---|`, i línies en blanc.

### Excepcions (es tradueix només una part)

- **Etiqueta de toggle** `:::toggle Etiqueta` → traduir només el text posterior a `toggle `.
- **Taula GFM** (línia que comença per `|`, amb la següent com a separadora): traduir
  **cel·la a cel·la**, re-escapant `\|` interns; la fila separadora intacta.
- **Marcador de línia preservat**: heading `#`/`##…`, llista `-`/`*`/`+`, numerada `1.`,
  checklist `- [ ]`/`- [x]`, callout/blockquote `>`. Es preserva el prefix (i la
  indentació, per a llistes niuades) i es tradueix només el text.

### Protecció de tokens inline (estil `_protect_acronyms`, token `XSEGnnnZZZ`)

Abans de cridar `translate()`, substituir per tokens neutres (restauració
case-insensitive), en aquest ordre de precedència:

1. Codi inline `` `…` `` → token sencer.
2. Etiquetes HTML `<…>` (`<br>`, `<u>`/`</u>`, `<div style=…>`/`</div>`) → token cadascuna
   (el contingut entre etiquetes SÍ es tradueix).
3. Imatges `![…](…)` → token sencer.
4. Wikilinks `[[…]]` / `[[…|alias]]` → token sencer.
5. Cites `[@key; @key2]` i `@key` solta → token.
6. Enllaços `[text](url)` → protegir **només la `url`** (inclou el sentinel
   `https://gnosi-file-protocol.local/…` i urls `<…>`); el `text` SÍ es tradueix.
7. Acrònims → `_protect_acronyms` de translate_row.

Després de `translate()`, **restaurar** tots els tokens.

### Limitacions v1 (acceptades; millores futures)

- **Marcadors d'èmfasi** (`**`, `*`, `_`, `~~`) no es tokenitzen → el MT els pot moure.
- **Text intern d'imatges i alias de wikilink** NO es tradueix (token sencer, per
  robustesa davant la peculiaritat `![|caption](url)` i de `[[id|alias]]`).
- **Frontmatter**: només es tradueix `title`. NO es toca `id`, `parent_id`, `table_id`,
  dates, tags ni camps tècnics.
- **Una crida HTTP per segment** → latència alta i possible rate-limit d'Apertium públic
  en pàgines llargues. Millora futura: batching de segments.

## Subpàgina creada

Es crea via `create_page(PageSaveRequest(...), background_tasks)` (NO `save_page_md` a mà:
create_page fa UUID, índex de caché, link-index i webhook — saltar-ho trencaria el refresc
de l'arbre). Una filla per idioma:

- `title` = títol traduït (fallback `"{títol_pare} ({lang})"`).
- `content` = body markdown traduït.
- `parent_id` = id de la pàgina origen.
- `metadata`: `translation_lang`, `translation_source_lang`, `translation_origin_id`,
  `translation_provider` (`mixed` si n'hi ha més d'un). **NO** s'hi posa `table_id` (a
  diferència de translate_row): una pàgina normal va a `WIKI/`.

## Endpoint

`POST /api/vault/skills/translate-page`, role `editor`.

```json
{ "page_id": "<uuid>", "target_languages": ["en", "es"], "button_action": "translate_page" }
```

Resposta: `{ "status": "ok", "page_id", "source_lang", "created": [...], "skipped": [...] }`.
Síncron (com translate_row). El bucle pesat s'embolcalla en `asyncio.to_thread` per no
bloquejar l'event loop.

## Restriccions / Edge cases apresos

- **Idioma origen igual al destí** → skip (no es crea filla).
- **Pàgina sense body** → es tradueix només el `title`.
- **El markdown traduït s'ha de re-parsejar net**: qualsevol directiva mal preservada
  penja BlockNote al render. Per això el contracte de passthrough és estricte i els tests
  unitaris validen round-trip estructural amb un `translate_fn` fals.
- **Idempotència**: re-executar crea filles noves (no deduplica), igual que translate_row.
  Millora futura: dedup per `(translation_origin_id, translation_lang)`.

## Configuració d'entorn

Idèntica a translate_row (mateixos proveïdors): clau DeepL al Keychain (`deepl_api_key`),
`SOFTCATALA_API_URL`/`APERTIUM_PUBLIC_API_URL`/`OPUS_IDLE_TIMEOUT_S` a `.env_shared`.
Vegeu [translate_row_skill.md](translate_row_skill.md).

## Test ràpid

```bash
# Unit del segmentador (sense xarxa, translate_fn fals)
cd /Users/ismaelgarcia/Projectes/monorepo/apps/gnosi
python3 -m pytest pipeline/skills/translate_page/scripts/test_markdown_segmenter.py -v

# Endpoint (backend a localhost:5002)
curl -X POST http://localhost:5002/api/vault/skills/translate-page \
  -H 'Content-Type: application/json' \
  -d '{"page_id":"<UUID>", "target_languages":["es","en"], "button_action":"translate_page"}'
```

---
name: translate_page
description: Tradueix el títol i el cos markdown d'una pàgina del Vault i crea una subpàgina filla per cada idioma destí, preservant les directives de Gnosi.
type: skill
status: active
---

# Skill: translate_page

## Propòsit

Donada una pàgina del Vault (document markdown `.md`), tradueix el seu **títol** i el
seu **cos** als idiomes destí indicats per l'usuari i crea una **subpàgina filla**
(`parent_id = page_id`) per cada idioma. És el germà de [translate_row](../translate_row/SKILL.md)
per a documents sencers en lloc de files de taula.

**Abast**: només pàgines markdown del Vault. Els PDFs del reader queden fora.

## Disparador

Disparada per la UI quan l'usuari clica «Tradueix la pàgina» al menú d'opcions de pàgina
(`VaultShell`). El frontend obre `TranslateLanguagesModal` (`mode="page"`) i fa POST a:

```
POST /api/vault/skills/translate-page
Body: { page_id: str, target_languages: [str], button_action: "translate_page" }
```

## Arquitectura

L'**endpoint** (a `backend/api/vault_routes.py`) coordina: llegeix la pàgina, detecta
l'idioma origen, tradueix `title` (pla) i `content` (markdown) i crea una subpàgina filla
per idioma via `create_page(...)`.

La **skill** (`scripts/markdown_segmenter.py`) exposa:
- `translate_markdown(body, src, tgt, ...) -> (str, set[providers])`: segmenta el markdown
  enriquit, tradueix només el text natural i el reconstrueix preservant l'estructura.
- `translate_title(title, src, tgt, ...) -> (str, provider)`: tradueix un títol pla.
- `detect_source_lang` es reexporta de `translate_row`.

La **traducció en si** (routing de proveïdors: Softcatalà, OPUS-MT, Apertium, DeepL) es
reutilitza **tal qual** de `translate_row` via `translate()`. Aquest mòdul només afegeix
la segmentació conscient de markdown.

## Segmentador (mirall de `markdown-mapper.js`)

El cos és **markdown enriquit**; el segmentador n'és el mirall en Python perquè el
resultat es re-parsegi net amb `richMarkdownToBlocks`. Processament línia a línia amb
màquina d'estats de bloc:

- **Passthrough verbatim**: fences ` ``` ` (inclou `gnosi-database`/`gnosi-view`),
  directives `:::`, `:::gnosi-ignore` (bloc sencer), `{{bibliography}}`, transclusions
  `![[...]]` en línia pròpia, regla `---`, separador de taula.
- **Marcador preservat**: headings, llistes, checklists, blockquotes/callouts → es
  tradueix només el text, no el marcador ni la indentació.
- **Etiqueta de toggle** i **cel·les de taula GFM** → es tradueixen.
- **Protecció inline amb tokens `XSEGnnnZZZ`**: codi inline, etiquetes HTML, imatges,
  wikilinks, cites (`[@key]`/`@key`), i la URL dels enllaços (el text de l'enllaç SÍ es
  tradueix).

El contracte complet i les limitacions v1 viuen a
`docs/dev_memory/directives/translate_page_skill.md`.

## Proveïdors i configuració

Idèntics a [translate_row](../translate_row/SKILL.md): Softcatalà NMT (`en↔ca`), Softcatalà
Apertium (`ca↔…`), OPUS-MT local (`es↔fr`), Apertium APy públic, DeepL (fallback, key al
Keychain). Variables d'entorn a `.env_shared` compartides. Sense cap configuració, els
parells principals funcionen out-of-the-box.

## Estructura de la subpàgina creada

```json
{
  "title": "<títol traduït>",
  "content": "<cos markdown traduït>",
  "parent_id": "<page_id origen>",
  "metadata": {
    "translation_lang": "<codi ISO 639-1>",
    "translation_source_lang": "<idioma origen detectat>",
    "translation_origin_id": "<page_id origen>",
    "translation_provider": "softcatala_nmt | apertium_public | deepl | mixed | ..."
  }
}
```

A diferència de `translate_row`, **no** s'hi posa `table_id`: la subpàgina és una pàgina
normal que va a `WIKI/`.

## Edge cases / Restriccions

- **Idioma origen igual al destí** → skip (no es crea filla).
- **Pàgina sense cos** → es tradueix només el títol.
- **Marcadors d'èmfasi** (`**`, `*`) i **alias de wikilink / text d'imatge** no es
  tradueixen en v1 (vegeu la directiva).
- **Una crida HTTP per segment**: pàgines llargues triguen i poden topar amb el rate-limit
  d'Apertium públic. Millora futura: batching.
- **Idempotència**: re-executar crea filles noves (no deduplica).

## Test ràpid

```bash
# Unit del segmentador (sense xarxa)
cd /Users/ismaelgarcia/Projectes/monorepo/apps/gnosi
python3 -m pytest pipeline/skills/translate_page/scripts/test_markdown_segmenter.py -v
```

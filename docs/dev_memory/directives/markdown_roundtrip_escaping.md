# Directiva: Escapat contextual al round-trip Markdown de l'editor del Vault

**Estat:** activa · **Data:** 2026-06-23 · **Fitxer afectat:** `monorepo/apps/gnosi/frontend/src/components/Vault/markdown-mapper.js`

## Problema

`inlineContentToMarkdown` serialitzava els nodes de text SENSE estil de manera literal
(sense escapar). Quan un usuari escriu text pla amb seqüències que tenen significat
Markdown, en desar+recarregar (blocs → md → blocs) markdown-it (via
`tryParseMarkdownToBlocks`) les reinterpreta com a format i el text es **corromp** amb
pèrdua silenciosa de dades:

- `the __init__ method` → `__…__` es parseja com a **strong** "init" (es perden els `_`).
- `use the \`ls\` command` → els backticks literals es tornen codi inline "ls".
- `*word*` enganxat → cursiva.
- (Adicional, mateix tipus de bug però a inici de línia: un paràgraf de text pla que
  comença per `# `, `> `, `- `, `1. `, `---` es reinterpreta com a heading/quote/llista/hr.)

## Decisió de disseny (acordada amb l'usuari 2026-06-23)

**Escapat CONTEXTUAL (mínim), no escapat complet.** La filosofia del projecte és Markdown
net i llegible a Obsidian; un escapat cec amb backslash a tot caràcter especial
(`my\_var\_name`, `2 \* 3`) embruta massa el `.md`. S'escapa NOMÉS allò que
CommonMark/markdown-it reinterpretaria de debò en aquell context.

Opcions descartades: (a) escapat complet estil remark-stringify cru → massa pol·lució;
(c) no escapar → la corrupció persisteix.

## Regles d'implementació

1. **Només text SENSE marques.** S'escapa un node `type:"text"` només si NO té cap de
   `bold/italic/underline/strike/code`. Dins de marques i dins de **code spans** i **code
   blocks** el text es deixa cru (paràmetre `escape=false` per a `codeBlock`). Ho exigeix
   l'usuari: "Escapar NOMÉS en trossos de text sense estil".

2. **Idempotència.** Escapar PRIMER el backslash literal (`\` → `\\`) i després la resta.
   markdown-it desfà els escapes de puntuació ASCII en parsejar, així que
   parse→serialize→parse és estable (no acumula backslashes). Verificació obligatòria:
   `md1 === md2` al round-trip real al navegador.

3. **Caràcters inline escapats (a qualsevol posició):**
   - Backslash `\` → `\\` (sempre primer).
   - Backtick `` ` `` → `` \` `` (tots; un backtick aïllat pot obrir codi).
   - `*` → escapat si és left- o right-flanking (regla de flanking de CommonMark). El cas
     net `2 * 3` (espais a banda i banda) NO s'escapa; `*word*`, `a*b` sí.
   - `_` → com `*` PERÒ amb la restricció intraword de CommonMark: `my_var_name` queda NET
     (els `_` envoltats de lletra/dígit no obren ni tanquen èmfasi); `__init__` SÍ s'escapa.
   - `~` → escapat quan forma part d'un `~~` (strikethrough GFM).
   - `[` d'un link/imatge inline `[...](` o `![...](` → escapat (`\[`). NO s'escapen els
     `[ref]` solts (markdown-it ja els deixa literals) → mínima pol·lució.

4. **Marcadors de bloc a INICI de línia** (només quan `atLineStart=true`, que es passa
   NOMÉS per a `paragraph` i list items —no per a headings/callouts/columns/toggles/cel·les):
   per cada línia del node, escapar el marcador inicial: `#{1,6}` (heading), `>` (quote),
   `-`/`+`/`*` + espai (bullet), `\d+[.)]` + espai (ordenada), `---`/`***`/`___` (hr),
   `===`/`--` solts (setext). Es processa per línia (split `\n`) ABANS de la conversió de
   soft-breaks a `<br>`.

5. **Boundary = whitespace.** Per al càlcul de flanking, l'inici/final del node de text es
   tracta com a espai (límit de paraula). Segur a la pràctica perquè BlockNote fusiona els
   nodes de text pla adjacents (un run de text pla és UN sol node) i els nodes amb marca
   emeten els seus propis delimitadors balancejats.

## Restriccions / Edge cases (NO fer)

- **NO escapar dins de code blocks** (`codeBlock` crida amb `escape=false`) → trencaria el
  codi (`a ** b`, `arr[0]`, etc.).
- **NO tocar wikilinks `[[…]]`, cites `[@key]`, transclusions `![[…]]`**: són branques
  pròpies del serialitzador (nodes `wikilink`/`cite`/`transclusion`), no passen per
  l'escapador de text. Verificar que segueixen round-trippejant.
- **NO aplicar marcadors de bloc** (`atLineStart`) a headings, callouts, columnes, toggles
  ni cel·les de taula: el seu prefix ja els treu d'inici de línia i són estructures fràgils.
- **NO escapar `<` / `>` inguts d'HTML**: el serialitzador injecta `<br>`, `<u>`, `<div
  style>` a propòsit; escapar `<` trencaria aquesta maquinària. Limitació coneguda: un
  `<tag>` literal en text pla encara es pot interpretar com a HTML (no reportat; fora
  d'abast).
- **Taules**: les cel·les es re-llegeixen crues (parser GFM propi), com toggle/callout →
  `escape=false`. Només escapen `|` (`\|`). NO afegir-hi escapat d'èmfasi/codi.

## Blocs HTML tipus 6 (`<table>`) es mengen el markdown posterior (fix 2026-07-16)

- **Símptoma:** enllaços `[text](url)` (i altres marques) es mostren com a text CRU a
  l'editor en tot el que ve DESPRÉS d'una taula HTML (`<table header-row="true">`,
  format del clon de Notion / serialitzador antic). Els wikilinks/mencions no ho
  semblen perquè es converteixen en un post-procés sobre nodes de text.
- **Causa:** per CommonMark, un bloc HTML tipus 6 (obert per `<table …>`) NOMÉS acaba
  en línia EN BLANC. `</table>` seguit immediatament de més markdown fa que el parser
  s'empassi la resta dins del bloc HTML.
- **Fix:** `parsePlainMarkdownBlock` normalitza abans de parsejar: insereix línia en
  blanc després de `</table>` (regex ancorada a línia: `/(^[ \t]*<\/table>[ \t]*)\n(?![ \t]*\n)/gm`).
  Només tags SOLS a la seva línia — un `<table>…</table>` inline en un paràgraf no obre
  bloc tipus 6 i no s'ha de tocar.
- **QA de referència:** pàgina amb `[A](u)` + taula sense blanc + `- [B](u)` + taula amb
  blanc + `- [C](u)` → els tres han de renderitzar com a enllaç ("Pla de futur i cures"
  n'era el cas real: 6/9 enllaços crus).

## Limitació PREEXISTENT (fora d'abast d'aquest fix)

El round-trip de paràgrafs amb **salts tous interns** (`\n` dins d'un node de text, p. ex.
Shift+Enter) NO és idempotent, i això és **independent de l'escapat** (passa igual amb
`alpha\nbeta`, sense cap caràcter especial). Causa: el serialitzador emet `\n` → `<br>\n`,
però el parser remapeja `<br>\n` a `\n\n ` (dos salts + un espai), que es reserialitza a
DOS `<br>`. Acumula `<br>` + espais a cada cicle desar/recarregar. Verificat al test de
mòdul (editor bàsic). El present fix d'escapat NO ho causa i de fet MILLORA la variant amb
marcador (`line1\n# line2` ja no promociona la 2a línia a heading, perquè s'escapa `\#`).
Arreglar la deriva del `<br>` requereix tocar la lògica de soft-breaks (separada) — tasca a
part.

## QA (obligatori, vegeu `feedback_vault_editor_qa_safety` i `feedback_collab_ws_bypasses_fetch_block`)

Round-trip de MÒDUL al dev server del worktree (https://localhost:5185) via `preview_eval`:
importar el mapper amb `?t=<nonce>` + `/@id/@blocknote/core`, `BlockNoteEditor.create()`,
i comprovar `richMarkdownToBlocks(blocksToRichMarkdown(richMarkdownToBlocks(md)))` → `md`
estable per a: `__init__`, `*word*`, backticks, `[ref]`, `my_var_name`, `2 * 3`, wikilinks,
cites, taules, callouts, marcadors de bloc a inici de línia. **NO teclejar a notes reals**
(autosave per WebSocket persisteix a disc).

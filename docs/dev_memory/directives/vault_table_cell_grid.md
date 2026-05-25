# Directiva: Graella de cel·les del Vault (cursor + copiar/enganxar estil Notion/Excel)

## Objectiu
Donar a `VaultTable` (i, en segon pas, a les propietats de pàgina de `PageViewModal`) un comportament de full de càlcul:
1. **Cursor de cel·la** navegable amb fletxes, independent de l'edició.
2. **Copiar/enganxar** valors entre registres (una cel·la → moltes), i blocs 2D des/cap a Excel.
3. **Selecció rectangular** (Shift+fletxes / Shift+clic) i *fill* d'un rang amb una sola cel·la.

## Concepte central: dos estats separats
Avui `VaultTable` només té `editingCell = { rowId, field, originalMetaKey }` (la cel·la amb l'input obert) i el clic obre l'edició directament. **Falta el "cursor".** Afegim:
- `activeCell = { rowId, field }` — la cel·la amb el cursor (vora ressaltada), **sense** editar.
- `anchorCell = { rowId, field } | null` — àncora de la selecció rectangular. El rang és el rectangle entre `anchorCell` i `activeCell` (per posició dins l'ordre de files/columnes). Si és `null`, el rang és només `activeCell`.

`field` és sempre la clau del *schema* (la mateixa que a `dynamicColumns`), no la `originalMetaKey`. La `originalMetaKey` es resol per fila amb `getMetaKey(note, field)` en el moment de llegir/escriure (els àlies i la normalització ja existeixen).

### Abast de la graella
El cursor recorre el **`title` (columna 0, sticky)** + les columnes de metadades (`dynamicColumns`). Queden fora: la columna d'accions i `last_modified`.

**El `title` és un cas especial** (decisió 2026-05-25, a petició de l'usuari):
- És **navegable** (primera cel·la en carregar) i **editable inline** (Enter/teclejar obre un `<input>` al seu propi `<td>`).
- Viu a `note.title`, **no** a `metadata` → camí d'escriptura propi `saveTitle()` (`PATCH { title }`) + override optimista separat (`optimisticTitles`, perquè `optimisticPatches` només abasta metadata).
- **Exclòs de l'enganxat/buidat en bloc**: `isPasteableType('title') === false` i `coerceValueForField(..., 'title')` retorna SKIP. Així una selecció rectangular el pot **copiar** (lectura de `note.title` a `getRangeCells`) però mai s'hi enganxa ni es buida (no es corrompen títols).
- **Clic = selecciona** la cel·la (no obre); **doble-clic = obre** la fitxa; obrir també amb el botó d'obrir o `Alt+O`. (NO s'aplica "clic sobre cel·la activa = edita" al títol, per evitar el xoc amb el doble-clic-obre.)
- Scroll horitzontal: com és sticky, el `moveCursor` **no** fa scroll quan el cursor hi és (nc===0) i la suma d'offsets de columnes comença a i=1.

## Model d'interacció (decisió)
- **Clic simple** sobre una cel·la → fixa `activeCell` (cursor), **no** obre l'editor.
- **Edita** quan: clic sobre la cel·la **ja activa**, **doble-clic**, **Enter**, o **teclejar un caràcter** imprimible (aquest últim substitueix el contingut, estil Excel; només `text`/`number`).
- **Esc** editant → tanca l'editor sense desar i manté el cursor a la cel·la. **Esc** amb cursor (sense editar) → neteja cursor i selecció.
- **Enter** dins l'input de `text`/`number` → desa i **mou el cursor avall** una fila (estil Excel).
- **Checkbox**: clic alterna (com ara); amb cursor a sobre, Espai/Enter alterna.
- **Computed** (`formula`/`rollup`) i `button`: el cursor hi pot aterrar però Enter no fa res; mai s'editen ni s'enganxen.
- **Imatge/`files`**: clic obre el media picker (com ara).

> ⚠️ Aquest model canvia el "clic = edita" actual a "clic = selecciona, segon clic/Enter/teclejar = edita". És intencional (cal un estat de selecció pur perquè ⌘C copiï la cel·la i no el text de l'input). Si l'usuari ho prefereix diferent, és l'únic punt a renegociar.

## Copiar / Enganxar
- **Copiar (⌘/Ctrl+C)** amb cursor/rang i sense editar:
  - Construeix una matriu 2D dels valors crus del rectangle seleccionat.
  - Desa-la **internament** en un `ref` (`clipboardRef`) preservant els valors JS reals (arrays per `multi_select`/`relation`, números, objectes `autoria`).
  - **A més** escriu una representació **TSV** (cel·les separades per `\t`, files per `\n`) a `navigator.clipboard.writeText` perquè enganxar a Excel/extern funcioni i com a *fallback*.
- **Enganxar (⌘/Ctrl+V)** amb cursor/rang i sense editar:
  - **Font preferent**: `clipboardRef` intern si existeix (mateixa sessió, conserva estructura). Si no, parseja el text del porta-retalls (TSV → matriu).
  - **Geometria** (estil Excel):
    - Si el destí és **una sola cel·la** → el bloc font s'expandeix des de l'`activeCell` cap avall/dreta, retallant als límits de la taula.
    - Si el destí és un **rang RxC** → per cada cel·la del rang, valor font = `font[r % filesFont][c % colsFont]` (*tiling* amb mòdul: omple el rang sencer encara que la font sigui 1×1 o no quadri exacte).
  - **Coerció per tipus** de la columna destí (vegeu sota). Les cel·les que no es poden coercir **s'ometen** (no es corromp la dada); es notifica el recompte d'omeses.

## Coerció per tipus (la vora esmolada) — `coerceValueForField`
Centralitzada a `cellGridUtils.js`. Si la font ve de la **mateixa sessió i mateixa columna/tipus**, es copia el valor cru sense coerció. En creuar tipus o venir de text extern:
- `text` → `String(value)`.
- `number` → parseja; si no és finit, **omet** la cel·la (no escriu NaN).
- `select`/`status` → només si el valor casa amb una **opció existent** (per id o títol via `idToTitle`); si no, **omet** (no es creen opcions automàticament en enganxar).
- `multi_select` → separa per coma; conserva només els valors que casen amb opcions existents.
- `relation` → casa per id o per títol contra les notes de la taula relacionada; conserva els ids que casen.
- `date` → si comença per `YYYY-MM-DD` es conserva tal qual (també si ve d'un datetime `YYYY-MM-DDT…`), **sense** passar per `toISOString()` perquè la conversió a UTC pot desplaçar el dia; si no, s'intenta parsejar i es formata a partir de components **locals**; si no és parsejable, s'omet.
- `datetime` → si és ISO amb `T` es conserva; si no, s'intenta parsejar (es normalitza via UTC, que per a un instant temporal és correcte); si no, s'omet.
- `period` → valida `YYYY-MM-DD/YYYY-MM-DD`; si no, omet.
- `checkbox` → booleà directe es manté; buit → `false`; *truthy* textual (`true`/`1`/`sí`/`si`/`x`/`✓`/`✔`/`yes`/`on`/`done`/`completat` → true); *falsy* textual (`false`/`0`/`no`/`off` → false); **qualsevol altre text → s'omet** (no forcem `false` per no esborrar dades en silenci).
- `autoria` → només si la font interna ja és un array d'autors; des de text pla, **omet** (massa complex).
- `formula`/`rollup`/`button` → **mai** s'escriuen.

## Escriptura en bloc (PATCH múltiple) — `applyBulkCellUpdates`
Un enganxat pot tocar N cel·les. **No** cridar `handleCellSave` N cops (faria N refetch via `onCellSaved`). En el seu lloc, replicar el patró de `removeOptionEverywhere`:
1. Dedupe d'actualitzacions per `id+key` (l'última guanya).
2. **Un sol** `setOptimisticPatches` amb totes les cel·les.
3. `Promise.allSettled` dels PATCH `PATCH /api/vault/pages/:id` (cos `{ metadata: { [key]: value } }`).
4. `onCellSaved()` **una sola vegada** al final.
5. *Rollback* només de les cel·les que han fallat + toast amb el recompte.

## Virtualització (TanStack Virtual) — restriccions
- Les files fora del viewport **es desmunten**; per tant la navegació **no** pot dependre del focus DOM per cel·la. El listener de teclat és **a nivell de finestra** (com el de ⌘O i `useVaultSelectionShortcuts`) i opera sobre l'estat `activeCell`, no sobre `document.activeElement`.
- En moure el cursor a una fila fora de pantalla, cridar `rowVirtualizer.scrollToIndex(index)`. L'índex és el de `rowDescriptors` (1:1 amb els virtual items). Construir l'ordre navegable filtrant `rowDescriptors` per `kind === 'row'` i guardar el seu índex de descriptor.
- L'ordre de files navegables inclou pares + subitems expandits, en l'ordre visual de `rowDescriptors`.
- *Lazy load*: si el cursor arriba a l'última fila carregada i `sortedNotes` en té més, cridar `handleLoadMoreRows()` abans de moure.

## Convivència amb dreceres existents
- `useVaultSelectionShortcuts` ja gestiona ⌘A (selecciona totes les files), Esc (neteja selecció de files) i Delete/Backspace (elimina files **només si** `selectedIds.size > 0`; si és 0, és un *no-op*).
  - **Delete/Backspace per buidar cel·les**: només actuar si `selectedIds.size === 0` (així no xoca amb l'esborrat de files). Si hi ha files seleccionades, Delete esborra files (comportament existent).
  - ⌘A es manté com a "selecciona files" (no el reinterpretem per cel·les).
- Tots dos *listeners* estan condicionats a `!editingCell`.
- El listener de teclat de la graella s'ha d'**ignorar** si el focus és en un INPUT/TEXTAREA/contentEditable aliè (ex.: cerca de la toolbar).

### Dreceres d'acció de fila (decisió 2026-05-25)
Amb el cursor a una fila (sense editar), tecles per disparar les accions de l'esquerra **sense** col·locar el cursor a la columna d'accions:
- `Alt+O` → obre la fitxa · `Alt+R` → obre el recurs (si en té) · `Alt+P` → obre en paral·lel (si hi ha `onOpenParallel`).
  - **Per `e.code`** (`KeyO/KeyR/KeyP`), no `e.key`: a Mac `Alt+lletra` produeix caràcters especials. No xoquen amb el teclejar-per-editar perquè aquest ignora `altKey`.
- `⌘/Ctrl+⌫` → **elimina** la fila del cursor (deliberat; `⌫` a soles segueix buidant la cel·la). Només si no hi ha selecció múltiple de files.
- Totes operen sobre `activeCell.rowId` i es llegeixen via `rowActionsRef` (el listener es munta un sol cop).

## QA segur (OBLIGATORI — vegeu memòria del Vault)
- **L'autosave escriu a disc** en editar/enganxar. **No** teclejar ni instrumentar a notes reals.
  - Proves de DOM/teclat al navegador via `javascript_tool` (les API de screenshot/read_page peten per timeout a la SPA amb polling).
  - Provar sobre pàgines **d'usar i llençar** o **bloquejant el PATCH** (`/api/vault/pages/:id`) abans de simular edicions.
- **Unit tests (Vitest)** de `cellGridUtils` (coerció/serialització/parseig TSV/geometria de rang) — segurs, no toquen disc. Són la xarxa de seguretat principal de la lògica.
- Build estàtic net: `npm run build` (frontend) sense errors abans de donar res per fet.
- **Sense paquets npm nous** (tot amb React + `navigator.clipboard` natiu) → no cal el cicle de rebuild de Docker.

## Restriccions / Edge-cases (memoritzar)
- No reordenar `dynamicColumns` ni assumir que `field === originalMetaKey`: sempre `getMetaKey(note, field)` per fila.
- `multi_select`/`relation` es desen com a **array**, no CSV (encara que el llegim tolerant a CSV).
- En enganxar a `select`/`relation` amb valors que no casen → ometre, no crear opcions/relacions noves.
- `title` SÍ que és a la graella (col 0) però amb camí d'escriptura propi i exclòs de paste/clear (vegeu "Abast de la graella"). `last_modified`/accions segueixen fora.
- El cursor i el rang s'han de **netejar** quan canvia la vista (`activeView.id`), la cerca o l'ordre, per evitar apuntar a files que ja no hi són.
- L'enganxat en bloc ha de respectar les files **realment presents** al destí (no crear files noves).

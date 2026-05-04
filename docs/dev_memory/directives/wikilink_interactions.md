# DIRECTIVE: WIKILINK_INTERACTIONS

> ID: WIKILINK-INT-2026-05-04
> Associated Code:
>   - `monorepo/apps/gnosi/backend/api/vault_routes.py` (endpoint `/pages/{id}/preview`)
>   - `monorepo/apps/gnosi/frontend/src/components/Vault/WikilinkInline.jsx`
>   - `monorepo/apps/gnosi/frontend/src/components/Vault/WikilinkHoverPreview.jsx`
>   - `monorepo/apps/gnosi/frontend/src/components/Vault/WikilinkContextMenu.jsx`
>   - `monorepo/apps/gnosi/frontend/src/components/Vault/BlockEditor.jsx` (integració)
>   - `monorepo/apps/gnosi/frontend/src/pages/VaultDashboard.jsx` (handlers)
> Last Update: 2026-05-04
> Status: ACTIVE

---

## 1. Objectiu i Abast

**Problema:** Els wikilinks `[[Pàgina]]` només permetien una acció (obrir en panell paral·lel) i no tenien preview. Calia un comportament estil Wikipedia/Notion: hover mostra preview, click vs. cmd-click vs. shift-click ofereixen 3 modes d'obertura, i el clic dret obre un menú amb les 3 opcions.

**Comportament resultant:**

| Acció | Mode | Handler de VaultDashboard |
|---|---|---|
| Click | Mateixa pestanya (reemplaça la tab activa) | `handleOpenInCurrentTab` |
| Cmd/Ctrl + Click | Nova pestanya (afegeix tab + focus) | `loadPage` |
| Shift + Click | Panell paral·lel (split view, max 4 panes) | `handleOpenParallel` |
| Hover (≥ 450ms) | Popup amb extracte (300 chars) | GET `/api/vault/pages/{id}/preview` |
| Right-click | Menú contextual amb les 3 opcions | (qualsevol dels anteriors) |

**Criteris d'èxit:**
- Cap regressió: navegació segueix funcionant tant amb UUIDs com amb títols.
- Hover no apareix abans de 450ms (no és sorollós en passar el ratolí ràpid).
- Hover es manté visible si el cursor entra dins el popup.
- Menú contextual es tanca amb Escape, click fora, o scroll.
- Cap conflicte amb ProseMirror/BlockNote (mousedown/mouseup parats a la captura).

## 2. Arquitectura

```
VaultDashboard
  ├─ loadPage(id)                  → "nova pestanya" (afegir + focus)
  ├─ handleOpenInCurrentTab(id)    → "mateixa pestanya" (reemplaça)
  └─ handleOpenParallel(id)        → "paral·lel" (split view)
        ↓ passats com a props a
BlockEditor
  └─ contextValue (VaultEditorContext)
        ↓ accedits per
WikilinkInline (per cada wikilink renderitzat)
  ├─ resolveTarget(raw, idToTitle) → UUID o lookup invers per títol
  ├─ Click handler dispatcher per modifier keys
  ├─ Hover handlers amb timer (open 450ms / close 180ms)
  ├─ ContextMenu handler
  ├─ <WikilinkHoverPreview/>       → portal a body amb popup
  └─ <WikilinkContextMenu/>        → portal a body amb menú
```

## 3. Backend (`/api/vault/pages/{page_id}/preview`)

**Resposta:**
```json
{
  "id": "uuid-or-resolved-id",
  "title": "Títol de la pàgina",
  "excerpt": "Primer paràgraf sanititzat (max 320 chars amb …)",
  "icon": "📘 o null",
  "cover": "url o null"
}
```

**Detalls:**
- Reutilitza `find_page_path` i `parse_frontmatter` (mateix patró que GET /pages/{id}).
- Sanitització a `_build_preview_excerpt`: elimina codi, HTML, wikilinks, MD links, headings, bold/italic, llistes, blockquote, hr.
- Si el primer paràgraf és curt (< 60% del límit), concatena els següents fins arribar al límit.
- **No** injecta virtual fields ni resol metadata complexa (vs GET /pages/{id}) → més ràpid per a tooltips.
- **OneDrive Errno 35**: degradat a resposta buida (no a 500). Preview no és crític.

## 4. Frontend — Cache de Preview

`WikilinkHoverPreview` manté `PREVIEW_CACHE` a mòdul (Map) amb:
- `CACHE_MAX = 100` entrades (evicció FIFO).
- `CACHE_TTL_MS = 5 min`.

**Per què a mòdul i no a context React:** el cache ha de sobreviure a remunts del component (cada wikilink en remunta el seu propi). Si el cache estigués a state, perdríem la cache cada vegada que es recompila el schema de BlockNote.

## 5. Click Handling — Conflictes amb ProseMirror

ProseMirror (l'editor sota BlockNote) processa `mousedown` ABANS que el `click` de React. Sense aturar el mousedown, ProseMirror posiciona el cursor al wikilink i pot prevenir el click. Per això a `WikilinkInline`:

- `onMouseDown` → `stopPropagation` + `stopImmediatePropagation`
- `onMouseUp` → mateix
- `onClick` → la navegació real
- `onAuxClick` → mateix handler que `onClick` (cobreix el clic mig que en alguns navegadors no dispara `onClick`)

**No** posar `contentEditable={false}` al span: en alguns navegadors fa que ProseMirror tracti el node com a atòmic i no dispari mai el handler React.

## 6. Resolució de Target (UUID vs. Títol)

`[[Resum estructurat del DVA]]` té com a target el títol literal, no un UUID. El backend espera UUIDs a GET /pages/{id}, així que cal lookup invers a `idToTitle` (case-insensitive, trim).

`resolveTarget(raw, idToTitle)`:
1. Strip `#section` (el backend no entén UUID#Section).
2. Si és UUID v4 → retorna directament.
3. Lookup invers per títol → retorna l'ID si troba.
4. Sense match → retorna el target original (backend retornarà 404, és l'error visible esperat per l'usuari).

## 7. Restriccions i Edge Cases

- **WikilinkInline és "stand-alone" per cada `<span>` wikilink**: cada wikilink té el seu propi estat de hover/menú. No hi ha estat compartit entre wikilinks. Això és intencional — l'alternativa (un sol popup global) tindria més carrega arquitectònica i no aporta valor.
- **`handleOpenInCurrentTab` tanca la tab anterior**: tanca tant el tab actiu com qualsevol entrada a `splitTabIds` que el referenciï. Si el tab actiu és l'únic tab, el comportament és equivalent a `loadPage` (no tanca res que no existeix).
- **Fallbacks de mode**: si l'embebedor (ex: ExcalidrawEditor, PageViewModal) només passa `onOpenParallel`, qualsevol mode degrada cap als handlers disponibles. Això evita que els wikilinks dins editors embeguts siguin "morts".
- **Scroll tanca el menú contextual** (no el hover): consistent amb patrons natius (Chrome, macOS).
- **No fer hover dins inputs**: actualment el hover també s'activa quan l'usuari edita la pàgina. Si esdevé molest, considerar pausar el hover quan `editor.isFocused` o quan el cursor és en un range selectable.
- **Cache de preview pot quedar stale**: si l'usuari edita una pàgina, el preview cached de fa < 5 min mostrarà contingut antic. Acceptable per un tooltip; si esdevé un problema, invalidar el cache via event bus quan es desa una pàgina.

## 8. Anti-Atajos

| Excusa | Refutació |
|---|---|
| *"Puc treure el delay de hover, és més ràpid"* | **Fals.** Sense delay, qualsevol scroll pel text dispara N peticions HTTP innecessàries. 450ms és el llindar comú (Wikipedia, Notion). |
| *"Puc tornar tot el body al endpoint preview, és més senzill"* | **Fals.** Un body de 50KB transferit per cada hover collapsa la xarxa i fa més lent el render. 320 chars sanititzats és suficient i barato. |
| *"Puc fer servir `window.open` per a la nova pestanya"* | **Fals.** El concepte de "tab" aquí és intern de l'app (tabs del Vault), no del navegador. `window.open` obriria una finestra nova del navegador, semàntica diferent. |
| *"Puc usar `contentEditable={false}` al span per protegir-lo"* | **Fals.** En alguns navegadors fa que ProseMirror tracti el node com a atòmic i no dispari el handler React. Vegeu secció 5. |

## 9. Red Flags

- Si el hover apareix instantàniament sense delay → revisa `HOVER_OPEN_DELAY` a `WikilinkInline.jsx`.
- Si el menú contextual apareix sota el wikilink i no a la posició del cursor → probablement el `position` no es passa o el `useLayoutEffect` no s'està disparant.
- Si el click reemplaça la tab però l'antiga roman visible → revisa `setTabs(prev => prev.filter(...))` a `handleOpenInCurrentTab`.
- Si els clicks dins ExcalidrawEditor o PageViewModal no fan res → manca el handler. El fallback hauria d'usar `onOpenParallel`. Si tampoc, és un problema d'instanciació.
- Cache de preview creix indefinidament → revisa `CACHE_MAX` (eviction FIFO).

## 10. Pre-Execution Checklist

- [x] Confirmat que el render del wikilink està centralitzat a `BlockEditor.jsx` (no n'hi ha múltiples a la base de codi).
- [x] Confirmat que `splitTabIds` és l'estat únic per a panells paral·lels (no hi ha duplicats).
- [x] Confirmat que `loadPage` ja té semàntica "afegir tab + focus" (= "nova pestanya").

## 11. Post-Execution Checklist (Verification Gates)

- [ ] `npm run build` (frontend) sense errors.
- [ ] `docker-compose up -d` (backend) arrenca sense errors.
- [ ] GET `/api/vault/pages/<id>/preview` retorna `{id, title, excerpt, icon, cover}`.
- [ ] Hover sobre un wikilink (≥ 450ms) mostra el popup amb el preview correcte.
- [ ] Click sobre un wikilink reemplaça la tab activa.
- [ ] Cmd/Ctrl + Click obre una nova tab sense tancar l'anterior.
- [ ] Shift + Click obre el panell paral·lel.
- [ ] Right-click obre el menú amb les 3 opcions.
- [ ] Escape tanca el menú.
- [ ] Smoke E2E (`npm run test:e2e:smoke`) passa.

## 12. Notes Addicionals

- Fase 2 futura: invalidació activa del cache via WebSocket o esdeveniment custom quan una pàgina es desa.
- Considerar afegir un atajo de teclat (Ctrl+Shift+P o similar) per obrir el menú contextual del wikilink sota cursor sense necessitar el ratolí.
- Si l'usuari té molts wikilinks en una pàgina (~100+), el cost és proporcional. Cada `WikilinkInline` és lleuger (no hi ha listeners globals fins que es fa hover). Mesurar amb React Profiler si esdevé visible.

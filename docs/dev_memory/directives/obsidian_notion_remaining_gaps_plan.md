# Pla d'implementació — Mancances restants Obsidian/Notion

> Estat 2026-06-24. Les 4 primeres mancances (daily notes, subtotals per grup, pàgina
> de tags, comentaris) ja estan fetes (branca `claude/heuristic-williamson-49000a`,
> veure memòria `project_obsidian_notion_gaps`). Aquest pla cobreix les **4 que queden**:
> col·laboració live real, compartir extern, canvas infinit independent i sistema de plugins.
> Tot el codi viu a `monorepo/apps/gnosi`.

## Resum executiu i seqüència recomanada

| # | Feature | Valor | Esforç | Risc | Dependència |
|---|---------|-------|--------|------|-------------|
| 1 | **Compartir extern** (enllaços públics + convidar per email) | Alt | Mitjà | Mitjà (seguretat) | Auth ja existeix |
| 2 | **Col·laboració live real** (CRDT/Yjs) | Alt | Alt | Alt (concurrència) | WS skeleton ja existeix |
| 3 | **Canvas infinit** (estil Obsidian Canvas) | Mitjà | Mitjà | Baix | Tldraw ja integrat |
| 4 | **Sistema de plugins** | Mitjà | Alt | Mitjà | Punts d'extensió ja existeixen |

**Ordre suggerit:** 1 → 3 → 2 → 4. Compartir i canvas són autocontinguts i de risc baix/mitjà;
la col·laboració CRDT és la més arriscada (deixar-la quan l'equip tingui marge); els plugins
els últims perquè es beneficien d'estabilitzar abans els punts d'extensió.

---

## 1. Compartir extern (enllaços públics + convidar per email)

**Estat actual:** auth JWT (`gnosi_session`, HS256, TTL 7d) + rols owner/admin/editor/viewer
(`workspace_service.py` ROLE_WEIGHTS), membres via `Membership` i accés per vault via
`VaultAccess` (`models/management.py`). Convidar membre crea `Membership` directament però
**no envia email ni token**. **No existeix** cap noció de compartir una pàgina concreta ni
accés anònim/temporal.

### Backend
- **Model nou `ShareLink`** a `models/management.py`:
  `id` (token opac uuid4), `page_id`, `workspace_id`, `created_by`, `permission`
  (`view`|`comment`|`edit`), `expires_at` (nullable), `revoked` (bool), `created_at`.
- **Router nou** `api/share_routes.py` (registrar a `server.py` amb prefix `/api`):
  - `POST /pages/{page_id}/share` (require_role `editor`) → crea ShareLink, retorna URL `/s/{token}`.
  - `GET /pages/{page_id}/shares` → llista enllaços actius de la pàgina.
  - `DELETE /share/{token}` → revoca (set `revoked=true`, no esborra: traçabilitat).
  - `GET /s/{token}` (SENSE `get_workspace_context`) → resol token, valida no-revocat i no-expirat,
    i retorna la pàgina en mode lectura (reutilitzar el cos de `get_page` però sense exigir membership).
    Important: aquest endpoint NO ha de passar pel `Depends(get_workspace_context)` global del
    `vault_router` → per això va en router PROPI amb dependència buida.
- **Convidar per email amb token:** estendre `POST /workspaces/{id}/members`
  (`workspace_routes.py`) perquè, si `send_invite=true`, generi un token de registre i enviï
  email via el servei de mail ja existent (`mail` service / SMTP de l'usuari). L'enllaç porta a
  `/register?invite=<token>` que pre-omple email i, en registrar-se, crea la `Membership`.

### Frontend
- **Modal "Compartir"** nou (`ShareModal.jsx`), obert des del menú "..." de `VaultShell`
  (afegir ítem "Comparteix" al costat de "Comentaris" — mateix patró que el botó de comentaris
  que ja vam afegir). Mostra: enllaços actius, selector de permís, botó "Crear enllaç" (copia al
  porta-retalls), revocar. I pestanya "Convidar per email".
- **Vista pública** `/s/:token`: pàgina mínima sense sidebar que renderitza el contingut amb
  `BlockEditor` en mode `isEditLocked`/read-only (ja suportat via prop `isEditLocked`).
  Si `permission==='comment'`, habilitar el panell `PageComments` (ja existeix).

### Fases
1. Model + migració + `POST/GET/DELETE /share` + `GET /s/{token}` read-only. QA via curl.
2. `ShareModal` + ruta pública frontend.
3. Permís `comment` (reusar PageComments) i `edit`.
4. Convidar per email amb token de registre.

### Riscos / QA
- **Seguretat:** `GET /s/{token}` és l'únic camí anònim → revisar que NO filtri altres pàgines,
  que respecti `revoked`/`expires_at`, i rate-limit. Tests: token revocat→403, expirat→403,
  permís view no permet PATCH.
- QA E2E des del worktree segons `feedback_worktree_backend_e2e_qa` (memòria).

---

## 2. Col·laboració live real (CRDT/Yjs)

**Estat actual:** WS `/api/vault/collab/{page_id}` (`collab_routes.py`) fa NOMÉS presència +
relay genèric (sense interpretar). Frontend: `hooks/useCollaboration.js` (només mode `org`) +
`CollaborationPresence.jsx` (avatars) muntat a `BlockEditor.jsx:3765`. L'autosave és HTTP
`PATCH /pages/{id}` cada 900ms amb el markdown SENCER + control d'etag (409 en conflicte, sense
merge). **Falta:** CRDT, sync del document pel WS, snapshot per a late-joiners, cursors, autorització per pàgina.

### Enfocament: Yjs + BlockNote collaboration
BlockNote té binding natiu de col·laboració amb Yjs (`@blocknote/core` + `y-protocols`).
El transport WS ja hi és; el TODO del propi mòdul ho diu: "afegir CRDT serà enviar
`{type:'update'}` per aquest mateix canal".

### Backend (`collab_routes.py`)
- Mantenir un `Y.Doc` per `page_id` viu en memòria (o awareness-only relay si es vol minimitzar
  estat al servidor). Mínim viable: **relay d'updates binaris** (ja es fa: relay genèric) +
  **snapshot**: el servidor guarda l'últim estat Yjs per page_id i el reenvia a qui entra tard
  (resol el TODO de late-joiners, línia ~26).
- **Persistència:** en `pause`/buit de peers, materialitzar el `Y.Doc` → markdown i fer
  `PATCH /pages/{id}` (reutilitzar la conversió `blocksToRichMarkdown`). Així el disc segueix
  sent la font canònica (vault-first) i Obsidian/sync continuen funcionant.
- **Autorització:** validar membership/permís a l'`accept()` del WS (avui no es fa — TODO línia ~24).

### Frontend
- Afegir `@blocknote/core` Yjs provider sobre el WS de `useCollaboration.js` (substituir l'autosave
  HTTP per page-en-col·laboració quan `mode==='org'` i hi ha >1 peer; mantenir HTTP com a fallback
  i com a camí únic en mode personal).
- **Cursors:** afegir awareness (cursor+selecció) i renderitzar-los (BlockNote ho suporta amb el
  collaboration cursor plugin). Reutilitzar el color estable per usuari de `CollaborationPresence`.

### Fases
1. Snapshot per a late-joiners (guardar últim estat al servidor i reenviar). QA: 2 pestanyes.
2. Binding Yjs a BlockNote en mode org (merge concurrent sense 409).
3. Persistència periòdica Y.Doc→markdown→PATCH.
4. Cursors/selecció via awareness. 5. Autorització WS per pàgina.

### Riscos / QA
- **Risc alt:** divergència Yjs↔markdown (el vault és markdown, no Yjs). Mitigació: el markdown
  és la font en repòs; Yjs només durant l'edició concurrent; en quiescència, materialitzar i
  descartar el Y.Doc. NO guardar `.ydoc` al vault (no portable a Obsidian).
- QA: 2 navegadors editant alhora (usar la recepta worktree + 2 sessions); verificar absència de
  409 i convergència. Cf. memòria `feedback_collab_ws_bypasses_fetch_block`.

---

## 3. Canvas infinit independent (estil Obsidian Canvas)

**Estat actual:** `TldrawEditor.jsx` (viewMode `drawing`) ja desa snapshots Tldraw a
`Drawings/{id}.tldraw.json` (`DrawingSaveRequest`, endpoints `/api/vault/drawings/*`), autosave
1s, i **ja suporta drag&drop d'una pàgina del sidebar** → crea un shape `note` amb
`meta.{pageId,pageTitle}` + panell d'accions en seleccionar. **Falta:** previsualització del
CONTINGUT de la nota dins la targeta i navegació/edició des del canvas (Obsidian Canvas mostra la
nota viva, no només un enllaç).

### Frontend (gros del treball)
- **Shape custom Tldraw "page-card"**: en lloc del shape `note` genèric, registrar un
  `ShapeUtil` propi que renderitzi un `<div>` amb el títol + un preview del cos (markdown
  truncat via `GET /pages/{id}` o el snapshot ja a `pages`), i un botó "Obrir" → `loadPage`.
  (Tldraw permet custom shapes amb React via `BaseBoxShapeUtil` + `HTMLContainer`.)
- **Crear nota des del canvas:** acció "Nova nota aquí" que fa `POST /pages` i incrusta la
  page-card. Connexions (arrows) entre cards = relacions visuals (només al canvas, no toquen el
  vault tret que es vulgui materialitzar com a wikilinks).
- **Enllaç viu:** quan el títol de la pàgina canvia, refrescar la card (rellegir per `pageId`).

### Backend
- Cap canvi imprescindible (els drawings ja persisteixen). Opcional: marcar el dibuix com
  "canvas" a `metadata` per distingir-lo a `VaultDrawings`. Opcional: materialitzar arrows com a
  relacions/wikilinks (reutilitzar `relation_sync`).

### Fases
1. ShapeUtil "page-card" amb títol + preview + obrir. 2. Crear nota des del canvas.
3. Arrows entre cards. 4. (Opcional) sincronitzar arrows↔wikilinks.

### Riscos / QA
- Rendiment amb moltes cards (Tldraw virtualitza, però el fetch de previews s'ha de cachejar).
- QA: crear canvas, arrossegar 2-3 pàgines, editar títol d'una i veure que la card s'actualitza,
  obrir des de la card. Cf. memòries de Tldraw existents (`feedback_embed_table_stacking_isolate`
  per a z-index dins editors).

---

## 4. Sistema de plugins

**Estat actual:** ja hi ha 4 punts d'extensió però NO formalitzats com a "plugins":
- **Blocs custom** d'editor: un sol lloc, `BlockEditor.jsx:977-1089` (`BlockNoteSchema.create`).
- **Slash menu**: `slashMenuUtils.js` + composició a `BlockEditor.jsx:~2709`.
- **Agent tools / MCP**: `agent/factory.py`, `agent/tools.py` (LangChain + MCP), `generated_tools/`.
- **Integracions**: `api/integrations_routes.py` (config JSON).

### Enfocament: registre declaratiu de plugins (no codi arbitrari de tercers)
Donat que executar codi arbitrari és un risc, el "sistema de plugins" v1 ha de ser un **registre
intern** que unifiqui els punts d'extensió, no un marketplace de codi extern.

- **Registre frontend** `plugins/registry.js`: cada plugin declara `{ id, name, blockSpecs?,
  slashItems?(ctx), sidebarItems?, settingsPanel? }`. `BlockEditor` i `VaultSidebar` recorren el
  registre en lloc de tenir els tipus hardcodejats. Migrar els blocs/slash actuals a entrades del
  registre (refactor sense canvi funcional → bona xarxa de seguretat).
- **Activació per usuari**: persistir plugins actius a `.gnosi/plugins.json` (patró custom_icons /
  page_comments). Endpoint `GET/PUT /api/vault/plugins`.
- **Backend tools com a plugins**: exposar `agent` tools + integracions sota el mateix manifest
  perquè la UI de Configuració mostri "Plugins" amb on/off.
- **(Futur, fora d'aquest v1)** sandbox real per a plugins de tercers (iframe + postMessage o
  WASM). Documentar-ho com a no-objectiu de v1 per seguretat.

### Fases
1. Refactor: extreure blocs/slash actuals a `plugins/registry.js` (sense canvi de comportament).
2. `GET/PUT /api/vault/plugins` + activació on/off + UI a Configuració.
3. Documentar l'API de plugin intern (com afegir un bloc + slash item declarativament).
4. (Backlog) sandbox de tercers.

### Riscos / QA
- El refactor toca el cor de l'editor: cobrir amb build + QA de regressió de TOTS els blocs
  existents (database, gnosi_view, transclusion, embed, bibliography, toggle, alert, wikilink, cite).
- Build net obligatori (memòria `feedback_regex_literal_build_passes_runtime_crashes`: verificar
  també al navegador, no només build).

---

## Protocol comú a totes

- **Branca neta des d'`origin/main`** per cada feature (memòria `feedback_branch_after_squash_merge`).
- **QA E2E del backend nou des del worktree**: arrencar uvicorn del worktree en port lliure (NO
  5099) contra vault `/tmp` + curl amb headers de workspace; per la UI, vite del worktree amb
  `VITE_BACKEND_PORT` cap al backend del worktree + shim XHR per a l'axios sense cookie
  (memòria `feedback_worktree_backend_e2e_qa`).
- **Vault-first**: estat nou (shares, plugins) a `.gnosi/*.json` amb `safe_write_json` + lock;
  res que trenqui la portabilitat a Obsidian (no `.ydoc` al vault).
- **`npm run build` net** + captura/DOM de verificació abans de declarar fet (QA Protocol CLAUDE.md).
- **Accessibilitat**: confirmació en accions destructives (revocar share, esborrar plugin) via
  `ConfirmModal` (memòria `feedback_destructive_action_confirm_accessibility`).

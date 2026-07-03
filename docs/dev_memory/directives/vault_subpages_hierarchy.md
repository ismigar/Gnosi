# Subpàgines jeràrquiques al Vault (subpàgines-sota-fila, parent_id, re-walk del clon)

**Objectiu:** que les subpàgines de Notion (pàgines niades dins de files de BD, wikis i taulells)
conservin la seva jerarquia a Gnosi via `parent_id`, en lloc d'aplanar-se totes com a pàgines
soltes del Wiki (símptoma observat: "Wiki inflat" amb 109 subpàgines aplanades al clon de
2026-07; les subpàgines de files de Cervell digital/Bitàcora hi apareixien barrejades).

## Model (decisió de disseny)

1. **La jerarquia és NOMÉS metadata (`parent_id` al frontmatter), mai carpetes.**
   - El vault ja té `parent_id` de primera classe: `PageSaveRequest`/`PagePatchRequest`/
     `PageInfo`/`SidebarPageInfo` a `vault_routes.py`, i la sidebar ja construeix arbres amb ell.
   - Els fitxers de subpàgina viuen a `Wiki/` (com el desat natiu de pàgines sense `table_id`).
2. **PROHIBIT col·locar subpàgines dins de la carpeta de la taula (`BD/<DB>/<Taula>/`).**
   - `GET /pages/by-table/{id}` decideix pertinença **per prefix de carpeta primer** (fast-path,
     `vault_routes.py` ~3394); el metadata només és fallback. Un `.md` dins la carpeta de la
     taula ES CONVERTEIX en fila de la graella → contaminació. No moure-hi mai subpàgines.
3. **L'enganxada a l'arbre la fa el FRONTEND (builder de `VaultSidebar.jsx`):** una pàgina amb
   `parent_id` i sense marcador de secció propi (ni `table_id`, ni dashboard) s'ha d'adjuntar a
   l'arbre on visqui el seu pare (fila de taula → `dataChildrenMap[taula].children[pare]`;
   wiki → `childrenMap[pare]`; dashboard → `dashboardChildrenMap[pare]`), resolent cadenes de
   pares (subpàgina de subpàgina) amb memoïtzació i guarda de cicles.

## Clon de Notion (`services/notion_clone.py`, passada 4)

- La passada 4 (BFS de `child_page`) clona cada subpàgina amb
  `_clone_standalone(cid, page, {"parent_id": clone_page_id(parent)})` — el pare és el node BFS
  que s'està escanejant. Les llavors (files + soltes triades) no porten `parent_id`.
- Els ids són deterministes (`clone_page_id` = uuid5) → la reparació retroactiva és possible
  sense taula de correspondència.

### Restrictions / Edge Cases

- **No baixar dins de `child_page` en extreure fills:** `_child_page_ids` ha de recórrer els
  `_children` dels blocs contenidors (toggle, columna, callout…) per trobar subpàgines niades,
  però **aturar-se a la frontera de `child_page`**: els néts pertanyen a la subpàgina (el BFS ja
  la visitarà com a pare). Baixar-hi atribuiria els néts al pare equivocat.
- Abans d'això, `_child_page_ids` només mirava el nivell superior → les subpàgines dins d'un
  toggle (patró Wiki: "carta amb toggle Notes") NO es clonaven.
- El cicle-safe del BFS (conjunt `seen`) fa que un fill amb dos pares quedi amb el PRIMER pare
  que el descobreix (ordre BFS) — mateix criteri que Notion (una pàgina té un sol pare).
- **Rendiment (pendent, no bloquejant):** `get_block_children` és recursiu i el BFS el crida a
  cada node → sub-arbres re-baixats. Optimització futura: escaneig shallow + pila pròpia.

## Re-walk (reparació del clon ja fet)

- Script idempotent (sandbox): mateixa traversal que la passada 4 contra Notion (REST, token
  local) → parells `(fill, pare)` → si `clone_page_id(fill)` existeix al vault del clon,
  `PATCH /api/vault/pages/{id}` amb `{parent_id: clone_page_id(pare)}` i capçalera `X-Vault-Id`
  del vault del clon. NOMÉS metadata: cap fitxer es mou (cf. §Model.2). Re-executable.
- Verificació: el Wiki root del clon queda amb les soltes reals; les subpàgines pengen de les
  seves files/wikis a la sidebar.

## Pendent (fora d'abast d'aquesta tanda)

- UI per CREAR subpàgines des d'una fila (menú contextual de la fila / botó a la pàgina).
- Mostrar la llista de subpàgines dins de la pàgina del pare (secció "Subpàgines").
- Sub-items de BD de Notion (files amb pare fila via relació): és una feature de BD, no de
  pàgines — no confondre amb això.

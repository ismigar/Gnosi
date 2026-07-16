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
3. **L'enganxada a l'arbre la fa el FRONTEND (builder de `VaultSidebar.jsx`):** la SECCIÓ d'una
   pàgina la decideixen els seus marcadors PROPIS, mai el pare per a dades (criteri del
   mantenidor, 2026-07-16): una pàgina sense `table_id` ni carpeta `BD/` és **WIKI encara que
   pengi d'una fila de BD** — la fila l'enllaça, però només els membres reals de la taula
   pertanyen a DADES ("Pla de futur i cures" no tenia propietats: no pot ser d'una BD). Al
   sidebar es nia sota el pare només si el pare també renderitza al wiki
   (`childrenMap[pare]`); si el pare és una fila, aflora a l'ARREL del wiki (el pare no
   renderitza mai a l'arbre wiki i la niaria en un node invisible). Les subpàgines de
   taulells SÍ hereten secció (dashboard → `dashboardChildrenMap[pare]`). Cadenes de pares
   resoltes amb memoïtzació i guarda de cicles.

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

- Eina: `pipeline/utils/rewalk_subpage_parents.py` (idempotent; dry-run per defecte):

      .venv/bin/python pipeline/utils/rewalk_subpage_parents.py --vault-id <ID>          # informe
      .venv/bin/python pipeline/utils/rewalk_subpage_parents.py --vault-id <ID> --apply  # repara

  L'`<ID>` del vault del clon surt de `GET /api/vaults`. NO baixa arbres de blocs: el pare de
  cada pàgina surt del `parent` incrustat a `search_pages()` (block_id → owner memoïtzat).
  `PATCH /api/vault/pages/{clone_page_id(fill)}` amb `{parent_id}` i capçalera `X-Vault-Id`.
  NOMÉS metadata: cap fitxer es mou (cf. §Model.2). Re-executable.
- Verificació: el Wiki root del clon queda amb les soltes reals; les subpàgines pengen de les
  seves files/wikis a la sidebar.

### Restrictions / Edge Cases (re-walk i multi-Mac)

- **Executa'l on el vault del clon estigui HIDRATAT.** En un segon Mac, un subarbre d'OneDrive
  acabat de sincronitzar pot estar encallat al File Provider: `stat()`/`read()` fallen amb
  `EDEADLK (Errno 11)` per a TOTS els processos (backend, daemons amb FDA inclosos) i
  l'indexador troba 0 fitxers. Navegar les carpetes amb el FINDER desencalla l'ENUMERACIÓ
  (noms visibles), però el CONTINGUT continua EDEADLK fins que OneDrive el baixa ("Manté
  sempre en aquest Mac" al Finder, o temps). No re-intentar amb força bruta: no és Gnosi.
- Un PATCH amb el vault a mig hidratar pot fallar per pàgina (el fitxer no és llegible);
  l'script continua i reporta — re-executar quan acabi la baixada (idempotent).
- `load_params` tolera un `params.yaml` de vault il·legible (warning + config heretada) des
  del #690 — abans un sol fitxer `.gnosi` encallat tombava tots els endpoints del vault.

## Pendent (fora d'abast d'aquesta tanda)

- UI per CREAR subpàgines des d'una fila (menú contextual de la fila / botó a la pàgina).
- Mostrar la llista de subpàgines dins de la pàgina del pare (secció "Subpàgines").
- Sub-items de BD de Notion (files amb pare fila via relació): és una feature de BD, no de
  pàgines — no confondre amb això.

# Directiva: persistència del Vault per NOM (mai `fld_*` al `.md`) + àlies

**Objectiu (decisió de l'usuari):** garantir que el frontmatter dels `.md` no
guardi mai claus opaques `fld_*`; les claus han de ser **noms humans**. Mantenir
la robustesa davant de renombrar columnes mitjançant **àlies** al registry
(Opció B), no reescrivint files (Opció A, descartada per risc).

## Principi clau

- "Brossa" = clau **opaca** per a un humà (`fld_a9e3dc94`). Un **nom**, encara
  que sigui antic, **no és brossa**.
- Per tant: la persistència a disc i les respostes API sempre per **nom actual**;
  el `fld_*` (id immutable) segueix existint **només a l'esquema** (registry),
  com a referència interna de vistes/filtres/seccions — NO al `.md`.

## Arquitectura actual (a invertir)

- Emmagatzematge canònic = per **id** (`fld_*`). `migrate_metadata_keys`
  (nom→id) s'aplica a l'escriptura: `POST /pages` (create_page, ~3018) i
  `PUT /pages` (save_page, ~4977). `save_page_md` (6 callers) serialitza el que
  rep.
- Lectura: `expand_metadata_for_response` (id→nom) a `GET /pages/{id}` (3379) i
  llistats (2909, 2932) afegeix el nom al costat de l'id.
- Tota la gestió d'ids està **centralitzada a `services/field_resolver.py`**;
  cap altre fitxer de runtime accedeix a `metadata['fld_…']` directament
  (formules, rule_engine, relacions, graph, node n8n llegeixen via
  `get_meta_value`, tolerant id|nom). → blast radius contingut.
- Frontend `schemaUtils.js`: `getMetaValue` tolerant (id→nom); **`setMetaValue`
  escriu per id** (reintrodueix `fld_` en editar cel·les). Vistes/filtres
  referencien camps per id (correcte, viu al registry, NO al `.md`).

## Disseny nou

### Esquema (registry)
- Cada property pot tenir `aliases: [str]` (noms antics). Absent = `[]`.

### `field_resolver.py`
- `resolve_property(table, ref)`: casa per id, **nom actual o àlies**.
- `canonical_name_for_key(table, key) -> Optional[str]`: nom actual de la
  property si `key` casa per id/nom/àlies; si no, `None`.
- `to_storage_names(metadata, table) -> (meta, changed)`: límit d'ESCRIPTURA.
  Per cada clau resoluble → reanomena-la al **nom actual**. Conflicte (diverses
  claus → mateixa property): prioritat **nom actual > id > àlies**. Claus no
  resolubles (propietats locals reals) es deixen intactes.
- `to_response_names(metadata, table)`: LECTURA. Còpia amb claus resoltes al nom
  actual; **elimina** les claus `fld_*` i àlies de la resposta (el frontend mai
  veu ids). Substitueix `expand_metadata_for_response`.

### Backend write boundary
- **Dins `save_page_md`**: resoldre la taula via `table_id` i aplicar
  `to_storage_names` ABANS de serialitzar. Així **els 6 callers** queden
  coberts → garantia que cap `.md` rebrà `fld_*` sigui quin sigui el camí.
- **Treure** `migrate_metadata_keys` (nom→id) de create_page i save_page.
- PATCH segueix fent merge; `save_page_md` canonicalitza el resultat fusionat
  (neutralitza els `fld_` que enviï el frontend durant la transició).

### Rename de columna (`patch_table_property`, ~9106)
- En canviar `name`: afegir el nom antic a `aliases` (dedup; treure el nom nou
  dels propis àlies; si el nom nou és àlies d'una altra property, treure'l
  d'allà). Desar registry. **No tocar cap pàgina** (instantani, robust offline).
- Les files amb el nom antic segueixen resolent via àlies; es migren soles al
  nom nou en el següent desament (lazy) i, en lectura, `to_response_names` ja
  mostra el nom actual.

### Frontend (`schemaUtils.js`)
- `setMetaValue`: escriure per **nom actual** (no id) i esborrar qualsevol clau
  `fld_*` residual del camp. `getMetaValue`: mantenir tolerant.
- NO canviar com vistes/filtres/seccions referencien camps (segueixen per id,
  viuen al registry).

## Restriccions / edge cases

- **No es perd cap id**: viu al registry; el `.md` només canvia de clau.
- Conflicte de claus al desar → prioritat fixada (nom actual > id > àlies);
  documentar i loguejar.
- Col·lisió nom nou ↔ àlies d'una altra property → el nom actual guanya; treure
  l'àlies conflictiu.
- Migració de dades existents: lazy (en desar) + resolució en lectura. Pàgines
  legacy amb `fld_` resolen igualment. Script batch opcional `to_storage_names`
  per netejar-ho tot d'una (com es va fer amb Recursos).

## QA (obligatori — contra Docker)

Docker munta `~/Projectes/monorepo/apps/gnosi/backend`; **editar al checkout
principal**, no al worktree. Frontend per HMR/dev server a 5173.
1. Build/lint frontend; reiniciar/recarregar `gnosi_backend`.
2. `GET /pages/{id}` d'una fitxa → claus per nom, cap `fld_`.
3. PATCH amb clau-nom → disc segueix per nom.
4. PATCH enviant una clau `fld_` (defensa) → disc canonicalitzat a nom.
5. `PATCH /tables/{t}/properties/{f}` renombrant → registry guanya àlies, files
   NO reescrites, `GET` resol al nom nou; fitxa amb nom antic encara resol.
6. `/by-table` i una taula amb fórmules/relacions → 200 i valors presents.

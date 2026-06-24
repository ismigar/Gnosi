# Directiva: Camp «Progrés» derivat (% de Tasques completades)

## Objectiu
Convertir el camp **Progrés** de la taula Projectes (`fld_ba83d2a5`) d'un `number` amb fraccions 0-1 desades a mà a un **camp derivat read-only** que mostra el % de Tasques relacionades amb `Estat="Fet"`, calculat **en llegir** (sempre fresc), amb abast complet (taula + vistes incrustades + sync Drupal).

## Decisió d'arquitectura
Usar el sistema **virtual fields** (`backend/api/virtual_fields.py`), l'únic mecanisme de camp-derivat realment cablejat (`inject_for_table` es crida des dels endpoints de taula). Es DESCARTEN:
- `backend/services/rule_engine.py` — rollups implementats però MAI instanciats (codi mort); a més llegeix la relació DIRECTA (`Projectes.Tasques`), que està buida.
- `frontend/.../rollupUtils.js evaluateRollup` — signatura trencada (`(values, aggregation)` vs crida `(config, note, ctx)`); retorna `undefined`.

**Calcular en llegir** (no materialitzar): el valor mai queda ranci, no es desa al `.md`, i com que s'injecta a la metadata abans que el frontend ordeni/filtri, ordenar/filtrar per Progrés funcionen.

## Fórmula (verificada: 19/22 projectes casen exacte)
`Progrés = round( #{Tasques amb Estat=="Fet"} / #{total Tasques que apunten al projecte} × 100 )`; **buit** si total=0.

## Restriccions / Edge-cases (memoritzar)
- **La relació viu a la INVERSA**: els projectes tenen `Tasques:[]` buit. Cal recórrer les pàgines de Tasques (`ebe5e40f334745779d1c589de14f15a4`) i agrupar pel camp `Projecte` (`fld_d7f76960`). NO mirar `Projectes.Tasques`.
- El backend despulla els wikilinks → a `metadata["Projecte"]` hi ha **ids nets** (llista). Defensa per títol per si hi ha enllaços manuals d'Obsidian.
- Només `Estat=="Fet"` compta (dades: Fet=549, buit=130, «Per fer»=5; cap «Revisat»). Parametritzat via `config.done_value`.
- **Escala 0-100** (no fracció) per casar amb `formatNumber` percent (que NO multiplica ×100, vegeu [[vault_field_formatting]]). `format:{kind:'percent', decimals:0}` → «88%».
- **NO persistir el derivat**: a `save_page_md`, després de `to_storage_names`, eliminar les claus de camps `type:"virtual"` abans d'escriure. NO tocar `to_storage_names` (l'usa també `to_response_names`, on SÍ volem el virtual a la resposta).
- `inject_for_*` necessita un `page_loader` per carregar les Tasques (el graf de wikilinks NO porta `Estat`). Sense provider → índex buit → camp buit (degradació segura).
- Memoïtzar l'índex de progrés per `_page_index_version` (evita recomputar-lo per cada pàgina a `refresh_view_snapshots`).
- Frontend: `isComputedType` ha d'incloure `'virtual'` (read-only); `renderCellContent` ha de formatar el virtual numèric amb el seu `format` (sense regredir `is_hub`/`is_orphan` booleans).

## Conversió del camp (registry)
L'API `PATCH /properties/{id}` NO cobreix `compute`/`format` top-level → editar `BD/vault_db_registry.json` (amb backup) i reiniciar el backend natiu. Patró: el camp «Centralitat» (taula Cervell) ja és `{type:"virtual", compute:"degree_centrality"}`.

## QA
`GET /pages/by-table/8e8d3c8d…` → Progrés 0-100 i buit als projectes sense tasques; taula mostra «88%» read-only; ordenar/filtrar; vista incrustada; desar projecte NO escriu Progrés al `.md`; `npm run build`+lint nets.

# Directiva: Importador de Notion (API) → Vault de Gnosi

**Objectiu:** funció reutilitzable al backend que reprodueix l'estructura d'un workspace
de Notion (bases de dades → taules, pàgines → pàgines, relacions, contingut → Markdown,
fitxers) dins el vault de Gnosi, amb un token d'integració de Notion configurable a la UI.

## Abast i fidelitat (LLEGIR PRIMER)

La fidelitat alta d'una "migració manual via connector MCP" té DUES fonts diferents:
- **API REST pública** (`api.notion.com`, token d'integració): exposa esquema, pàgines,
  relacions, blocs i fitxers. → reproduïble per una funció backend.
- **Connector MCP allotjat de Notion** (endpoint AI/intern): exposa a més un **resum de
  vistes** (`type`, `displayProperties`). → un token d'integració NO ho dóna.

**Conseqüència:** la funció backend (Fase 1) reprodueix ~90% (estructura + dades +
relacions + contingut + fitxers). Les **vistes** NO són a l'API pública → s'apliquen
heurístiques. La fidelitat 100% de vistes requereix MCP-OAuth (Fase 2, opcional).

## Arquitectura

```
backend/services/notion_importer.py   # client + transforms purs + orquestrador
backend/api/notion_routes.py          # endpoints (registrat a server.py prefix /api/notion)
frontend: NotionImportSettings.jsx     # pestanya a GlobalSettingsModal (token + botó importar)
```

- **Token:** a `cfg.paths["SECRETS"]/integrations.json` sota clau `notion` (patró Google).
  Mai al registry ni al vault. Capçaleres: `Authorization: Bearer <token>`,
  `Notion-Version: 2022-06-28`.
- **Escriptura a Gnosi:** REUSAR els endpoints existents (NO escriure fitxers a mà):
  - Taules: `POST /api/vault/tables` (upsert per `id`; `properties[]` amb `id/name/type/...`).
  - Files/pàgines: `POST /api/vault/pages` (`metadata.table_id` + valors per NOM de camp).
  - Vistes: `POST /api/vault/views` (upsert per `id`).
  Així l'estampat d'autoria, carpetes, assets i índex es fan sols.

## Endpoints Notion usats (REST pública)

- `POST /v1/search` (filtra `object:database`) → descobreix BD compartides amb la integració.
- `GET /v1/databases/{id}` → esquema (properties + opcions select/multi amb color).
- `POST /v1/databases/{id}/query` (paginat, `start_cursor`/`has_more`) → files.
- `GET /v1/pages/{id}` → valors de propietats d'una pàgina.
- `GET /v1/blocks/{id}/children` (paginat, recursiu) → contingut.
- Fitxers: l'URL de `file`/`image` és S3 amb expiració ~1h → baixar a l'instant.

**Rate limit:** ~3 req/s de mitjana. Implementar throttle + retry exponencial al 429
(respecta `Retry-After`). Paginació a TOTS els llistats.

## Mapeig de tipus de propietat (Notion → Gnosi)

| Notion | Gnosi `type` | Notes |
|---|---|---|
| `title` | `title` | és el títol de la pàgina (camp canònic) |
| `rich_text` | `text` | concatenar `plain_text` |
| `number` | `number` | preservar `format` si cal |
| `select` | `select` | opcions `{name,color}` (mapejar paleta Notion→Gnosi) |
| `multi_select` | `multi_select` | íd. |
| `status` | `status` | íd. + grups si Gnosi els suporta |
| `date` | `date` / `period` | si té `end` → `period` |
| `people` | `text`/`person` | resoldre nom via `/v1/users` |
| `files` | `file` | baixar a `Assets/` de la taula |
| `checkbox` | `checkbox` | |
| `url`/`email`/`phone` | `url`/`email`/`phone` o `text` | |
| `relation` | `relation` | `relation_database_id` ← mapa de BD; 2 passades |
| `formula`/`rollup` | derivat (read-only) | desar el valor calculat com a text; NO recalcular |
| `created_time`/`created_by`/`last_edited_*` | camps natius d'autoria | ja existeixen a Gnosi |

## Mapeig de blocs (Notion → Markdown)

paragraph→text · heading_1/2/3→`#`/`##`/`###` · bulleted/numbered_list_item→`-`/`1.`
· to_do→`- [ ]`/`- [x]` · toggle→`> ` o detall · quote→`>` · code→fence amb llenguatge
· callout→`> [!note]` · divider→`---` · image/file→`![](ruta)` (baixat) · bookmark→
`[bookmark: url](url)` (LinkCardBlock ja existeix) · table→taula Markdown · equation→`$$`
· child_page/child_database→enllaç `[[…]]` a la pàgina/taula importada · synced_block→
contingut inline (Gnosi té els seus). Rich text: bold/italic/code/strike/link/color.

## Tancament transitiu (crawler BFS) — IMPLEMENTAT 2026-06-26

Importar una sola BD deixava ORFES: relacions a BD no importades, blocs
`child_page`/`child_database` i mencions a altres pàgines. Solució: `import_workspace` és
un **crawler BFS sobre el graf de referències**:
- En importar una BD → s'encuen les BD destí de les seves propietats `relation` (esquema).
- En importar una pàgina/fila → `discover_block_refs` escaneja els blocs i encua els
  `child_page`/`child_database`/`link_to_page`/mencions inline.
- **Conjunt de visitats** (BD + pàgines) → segur amb cicles (Projects↔Tasks↔Areas).
- Una pàgina descoberta amb `parent.type == database_id` s'enruta a importar la seva BD
  (no com a pàgina solta sense `table_id`).
- `max_pages` (def. 5000) evita desbordaments i es REPORTA `truncated` (cap tall silenciós).
- Flags `follow_relations`/`follow_children` (UI: toggle "Seguir relacions i enllaços").
Com que `gnosi_id_for` és determinista, el cablejat de relacions casa sol un cop el destí
s'importa. Tests amb `FakeClient`: tancament, cicle, child page, fila→BD, truncament.

## Resolució de relacions (2 passades, OBLIGATORI)

1. **Passada A:** crear TOTES les taules i TOTES les pàgines, mantenint un mapa
   `notion_page_id → gnosi_page_id` (i `notion_db_id → gnosi_table_id`).
2. **Passada B:** per cada propietat `relation`, traduir els IDs de Notion al `gnosi_id`
   via el mapa i fer `PATCH`/`POST` per cablejar. El backend NO sincronitza inversos →
   executar `sync_inverse_relations` després (cf. [[feedback_vault_relations_bytable_source]]).

## Vistes (heurística — Fase 1)

L'API pública no dóna vistes. Per cada taula importada:
1. Crear SEMPRE la vista de taula per defecte amb totes les propietats visibles.
2. Si la taula té un camp `status` (o un únic `select` dominant), crear OPCIONALMENT una
   segona vista agrupada per aquest camp (`groupBy`), reusant el suport d'agrupació de
   `VaultTable`/`PageViewModal` (afegit 2026-06-25). Configurable amb un flag de la petició.

Fidelitat 100% de vistes (filtres/sort/group reals) = **Fase 2** via MCP-OAuth a
`mcp.notion.com` (client MCP + OAuth al backend). Documentat, no implementat a Fase 1.

## Endpoints de la funció

- `POST /api/notion/token` — desa/valida el token (prova amb `/v1/users/me`).
- `GET  /api/notion/databases` — llista BD compartides amb la integració.
- `POST /api/notion/import` — body `{database_ids?, root_page_id?, create_group_views?,
  target_folder?}`; retorna `{tables, pages, relations, files, errors[]}`. Llarg → ideal
  com a job amb progrés (SSE estil mail), o síncron amb timeout generós a Fase 1.

## Reconciliació amb un vault JA migrat (CRÍTIC — descobert 2026-06-26)

El vault de Gnosi es va sembrar des d'aquest Notion i **CONSERVA els ids de Notion**:
`metadata.id` de cada pàgina == id de Notion (p.ex. vault "Oci" = `103268e5-2714-8069-…`
= Notion "📌 Ocio"); i els `table_id` == id de la BD de Notion (p.ex. Àrees =
`90e31c41f815489b99f30086b120cbfa`, que és l'`ancestor-2-database` real, NO l'id que torna
`/search`, afectat per la dualitat database↔data_source de 2025). Conseqüències:

1. **Aparellament per id, exacte** (no per títol). 13/13 BD de Notion ja existeixen com a
   taules (noms en català). Eina: `services/notion_diff.match_pages` (id → fallback títol).
2. **El contingut HA DIVERGIT**: el vault s'ha traduït ES→CA i editat des de la migració
   (demo real "Ocio/Oci": `body_similarity=0.196`, 6 vs 5 vistes incrustades, relacions
   4 vs 3). **Un re-import amb `gnosi_id_for(uuid5)` DUPLICARIA; un re-import per id raw
   SOBREESCRIURIA la feina en català.** Cap de les dues és acceptable per defecte.
3. **Per tant NO és una migració, és un SYNC amb el vault per davant.** L'importador, sobre
   aquest vault, ha de: (a) usar l'id RAW de Notion (no uuid5); (b) per defecte **dry-run
   diff** (`services/notion_diff`); (c) **mai sobreescriure pàgines `diverged`** sense
   confirmació explícita — només afegir les genuïnament NOVES (`notion_only`).
4. **Vistes incrustades**: representacions diferents (vault `<!-- gnosi-view:def {view_id} -->`
   ↔ Notion `child_database`/`<database inline>`). Comparar per nombre + secció (heading),
   no per text. Eines: `extract_vault_views` / `extract_notion_child_databases`.

Motor de diff (PUR, testejat 9/9): `services/notion_diff.py` — `diff_page` retorna
`{body_similarity, body_status(identical|similar|diverged), notion/vault_embeds, safe_action}`.

## Restriccions / casos límit (omplir a mesura que es trobin)

- **Files S3 expiren ~1h** → baixar durant la importació, no desar l'URL.
- **Rate limit 429** → throttle + `Retry-After`; no paral·lelitzar agressiu.
- **Paginació** a search/query/blocks/users → no assumir 1 sola pàgina.
- **Relacions primer crear-ho tot** → mai cablejar a la passada A (l'objectiu pot no existir).
- **`formula`/`rollup` read-only** → desar valor, no intentar recalcular (cf.
  [[feedback_zotero_mapping]] READ_ONLY_FIELDS).
- **Opcions select** → normalitzar a `{name,color}` (cf. [[feedback_rich_option_catalog_normalize]]).
- **Reimportació** → upsert idempotent per `id` derivat de l'ID de Notion (uuid5) per no duplicar.

## QA (obligatori abans de tancar)

1. **Transforms purs** (mapeig propietat + bloc→markdown): pytest amb fixtures sintètiques
   de payloads Notion (NO cal token). Verificable amb py_compile + funcions extretes
   (cf. [[feedback_local_backend_test_verification]]).
2. **E2E live**: amb un token d'integració real, importar 1 BD a una carpeta de proves i
   verificar taula+files+relacions+contingut al navegador (cf. [[feedback_qa_verify_persistence]]).
3. **Stopping rule**: "no s'ha pogut provar" = no fet.

## Fases

- **Fase 1** (aquesta): REST pública + heurística de vistes + transforms testejats.
- **Fase 2** (opcional): MCP-OAuth per a fidelitat 100% de vistes; job amb progrés SSE.

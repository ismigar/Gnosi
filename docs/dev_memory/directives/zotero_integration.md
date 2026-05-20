# Directiu: Integració Zotero ↔ Vault

> ID: ZOTERO-INTEGRATION-20260509
> Estat: viu — pla d'evolució multi-fase actiu (vegeu §6).
> Skill associada: `monorepo/apps/gnosi/pipeline/skills/zotero_sync/SKILL.md`

---

## 1. Objectiu

Sincronitzar bidireccionalment la biblioteca local de Zotero amb una taula del Vault de Gnosi (per defecte "Recursos"), de manera que:

- Els ítems de Zotero apareguin com a pàgines del Vault amb metadata estructurada.
- Els canvis a la metadata del Vault es puguin propagar a `zotero.sqlite`.
- L'usuari pugui personalitzar el nom de les columnes sense trencar la sincronització.

## 2. Arquitectura

```
┌───────────────────┐  POST /api/zotero/sync     ┌────────────────────┐
│ GlobalSettings UI │──────────────────────────►│ zotero_routes.py   │
│   (tab "Zotero")  │  POST /api/zotero/sync-back│ (FastAPI)          │
└───────────────────┘                            └─────────┬──────────┘
                                                           │ subprocess
                                                           ▼
                                  ┌─────────────────────────────────────┐
                                  │ pipeline/skills/zotero_sync/scripts │
                                  │  • zotero_to_vault.py   (Z→G)       │
                                  │  • gnosi_to_zotero.py   (G→Z)       │
                                  │  • backup_zotero.sh                 │
                                  └─────────────────────────────────────┘
                                                ▲
                                                │ llegeix/escriu
                                                ▼
                            ┌──────────────────────────────────┐
                            │ ~/Zotero/zotero.sqlite (local)   │
                            └──────────────────────────────────┘
```

## 3. Identitat de pàgina

- **Camp clau:** `metadata.zotero_key` (key Zotero immutable).
- Pàgines del Vault sense `zotero_key` són invisibles per al sync (Fase 3 introduirà match per títol normalitzat).

## 4. Model de mapping (resilient a renames)

El `mapping` del config (`zotero_db_config.json`) **persisteix l'`id` de property** (UUID immutable del registry del Vault), no el `name`.

```json
"mapping": {
  "title": "<uuid-property-1>",
  "creators": "<uuid-property-2>"
}
```

**Per què:**
- El registry del Vault tracta el `name` com a etiqueta cosmètica (cf. `PATCH /vault/tables/{id}/properties/{field_id}`).
- El frontend resol metadata key ↔ property per normalització del nom (`VaultTable.jsx::getMetaKey`), però aquesta resolució és best-effort i pot fallar si l'usuari renombra la columna a un valor sense relació semàntica.
- Persistir l'`id` immutable garanteix que el sync trobi sempre la columna correcta. Al moment d'escriure al payload, traduïm `id → name actual` consultant el registry. Així el frontmatter sempre conté la clau vigent.

**Migració del config existent:** si `mapping` té noms en lloc d'UUIDs, fer lookup un cop al primer arrencada de Fase 1 i reescriure amb UUIDs (idempotent).

## 5. Schema "Recursos" localitzat

El schema per defecte de la taula es genera a `POST /api/zotero/setup` segons `lang` (en/ca/es/fr). L'anglès és el fallback.

| Camp Zotero | en | ca | es | fr |
|---|---|---|---|---|
| title | Title | Títol | Título | Titre |
| zotero_key | Zotero Key | Clau Zotero | Clave Zotero | Clé Zotero |
| typeName | Type | Tipus | Tipo | Type |
| creators | Authors | Autors | Autores | Auteurs |
| date | Date | Data | Fecha | Date |
| url | URL | URL | URL | URL |
| doi | DOI | DOI | DOI | DOI |
| abstractNote | Abstract | Resum | Resumen | Résumé |
| tags | Tags | Etiquetes | Etiquetas | Étiquettes |
| dateAdded | Created | Creat | Creado | Créé |
| dateModified | Modified | Modificat | Modificado | Modifié |

L'usuari pot renombrar lliurement després de la creació; gràcies a §4 el sync no se'n veu afectat.

## 6. Pla d'evolució

| Fase | Estat | Resum |
|---|---|---|
| 0. Consolidació skills | ✅ 2026-05-09 | Unificació `zotero_sync` + `zotero_management` → única skill canònica. |
| 1. Backend: `inspect`, `suggest-mapping`, `setup` localitzat | ✅ 2026-05-09 | Endpoints per descobrir l'esquema i suggerir un mapping per heurística. Migració de mappings legacy idempotent. Schema localitzat ca/es/en/fr a `POST /setup`. |
| 2. UI de mapping | ✅ 2026-05-09 | `ZoteroMappingModal.jsx` amb selects per `property_id` i auto-suggeriment. Auto-launch de la modal després de `setup` quan hi ha unmapped/conflicts. Badge d'estat al panell. |
| 3. Robustesa del sync | ✅ 2026-05-09 | Match per títol normalitzat per pàgines pre-existents (counter `linked`), sync incremental (skip per `dateModified > last_sync_at`), `READ_ONLY_FIELDS` que mai s'escriuen a sqlite. |
| 4. UX/observabilitat | ✅ 2026-05-09 | `GET /last-sync` endpoint, panell "Darrera sincronització" amb timestamps i comptadors per direcció, polling post-sync amb toast estructurat, selector `existing_pages_strategy`, logs estructurats al backend que parsegen el JSON dels scripts. |
| 5. Documentació | ✅ 2026-05-09 | Directiu i SKILL.md tancats; memòria persistent `feedback_zotero_mapping.md`. |
| 6. Linked attachments (PDFs) | ✅ 2026-05-10 | Camp `attachmentPath` resolt des de `itemAttachments`; suport per `attachments:` (linked base = Biblioteca per defecte) i `storage:` (`~/Zotero/storage`). Cap còpia: tant Zotero com Gnosi apunten al mateix PDF. |
| 7. Creators `autoria`-aware (Z→G) | ✅ 2026-05-20 | `zotero_to_vault.py` escriu autors **estructurats** `{nom,cognom1,cognom2}` quan el camp de creators és tipus `autoria` (firstName→nom, lastName→cognom1, cognom2 buit); fallback a string per a camps `text`. No trenca la migració del tipus `autoria`. G→Z intacte (`creators` és READ_ONLY). Vegeu `autoria_field_type.md`. |

## 7. Restriccions

- **macOS-local only:** el sync llegeix `zotero.sqlite` directament i utilitza `pgrep -x Zotero`. No suporta API web Zotero ni Linux/Windows (fora d'abast actual).
- **Zotero ha d'estar tancat per al sync G→Z:** evita corrupció del SQLite mentre Zotero hi escriu. La verificació es fa via `pgrep` abans del subprocess.
- **No hi ha resolució de conflictes:** si la mateixa pàgina ha estat editada a Zotero i a Gnosi entre syncs, l'última escriptura guanya. No hi ha merge.
- **Mapping per `property_id` és la única font de veritat:** mai escriure noms de property al config; sempre UUIDs.

## 8. Fitxers crítics

| Path | Rol |
|---|---|
| `monorepo/apps/gnosi/backend/api/zotero_routes.py` | Router `/api/zotero/*` |
| `monorepo/apps/gnosi/pipeline/skills/zotero_sync/SKILL.md` | Skill canònica |
| `monorepo/apps/gnosi/pipeline/skills/zotero_sync/zotero_db_config.json` | Config persistent |
| `monorepo/apps/gnosi/pipeline/skills/zotero_sync/scripts/zotero_to_vault.py` | Sync Z→G |
| `monorepo/apps/gnosi/pipeline/skills/zotero_sync/scripts/gnosi_to_zotero.py` | Sync G→Z |
| `monorepo/apps/gnosi/pipeline/skills/zotero_sync/scripts/backup_zotero.sh` | Backup carpeta `~/Zotero` |
| `monorepo/apps/gnosi/frontend/src/components/GlobalSettingsModal.jsx` | UI tab "Zotero" |

## 9. Cicle d'aprenentatge

| Data | Aprenentatge | Causa | Solució |
|---|---|---|---|
| 2026-04-08 | Skills fragmentades | Directius duplicats (backup vs sync) | Skill unificada `zotero_management`. |
| 2026-05-09 | `zotero_management` i `zotero_sync` divergien | API apuntava a `zotero_sync`; docs a `zotero_management` | Consolidació en `zotero_sync` (Fase 0). |
| 2026-05-09 | Mapping fràgil davant renames | Config persistia `name` de property | Mapping per `property_id` (UUID immutable); resolució `id → name` al runtime (Fase 1). |
| 2026-05-09 | Schema barreja idiomes | `RECURSOS_SCHEMA` constant en català/anglès | Schema localitzat a `POST /setup` segons `lang` actiu (Fase 1). |
| 2026-05-09 | Pàgines pre-existents duplicades | Identitat per `zotero_key` només; pàgines manuals quedaven invisibles | Match per títol normalitzat amb counter `linked` que omple el `zotero_key` que faltava (Fase 3). |
| 2026-05-09 | Sync escrivia camps owned-by-Zotero | El cicle G→Z propagava `dateAdded`/`dateModified` cap a sqlite | `READ_ONLY_FIELDS` filtra sempre, encara que estiguin al mapping (Fase 3). |
| 2026-05-09 | Sense visibilitat del que feia el sync | Els scripts només imprimien una línia genèrica | JSON resum a stdout + `GET /last-sync` + panell UI amb comptadors per direcció (Fase 4). |
| 2026-05-09 | Subprocess no podia importar `safe_io` | Scripts standalone sense `sys.path` cap a `backend/` | Reimplementació local del patró tmp+`os.replace` per escriptures atòmiques (Fase 3). |
| 2026-05-10 | PDFs duplicats si gestionats a mà | Sync inicial només portava metadata, no attachments | `attachmentPath` resolt des de `itemAttachments` (linkMode `attachments:` o `storage:`); ruta absoluta compartida sense duplicats (Fase 6). |

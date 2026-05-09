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
| 1. Backend: `inspect`, `suggest-mapping`, `setup` localitzat | 🚧 | Endpoints per descobrir l'esquema i suggerir un mapping per heurística. Migració de mappings legacy. |
| 2. UI de mapping | ⏳ | `ZoteroMappingModal.jsx` amb selects per `property_id` i auto-suggeriment. |
| 3. Robustesa del sync | ⏳ | Match per títol normalitzat per pàgines pre-existents, sync incremental, validació de tipus. |
| 4. UX/observabilitat | ⏳ | `last-sync` endpoint, comptadors, logs estructurats. |
| 5. Documentació | ⏳ | Tancament del directiu + memòria. |

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
| 2026-05-09 | Mapping fràgil davant renames | Config persisteix `name` de property | Migració a `property_id` (Fase 1, planificada). |
| 2026-05-09 | Schema barreja idiomes | `RECURSOS_SCHEMA` constant en català/anglès | Schema localitzat a `POST /setup` (Fase 1, planificada). |

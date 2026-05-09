# SKILL: Zotero Sync

Skill canònica de la integració Zotero. Substitueix la skill obsoleta `zotero_management` (consolidada el 2026-05-09).

> ID: ZOTERO-SYNC-20260509
> Stack: Python 3.11+, sqlite3, requests, rsync (bash)
> Backend hooks: `monorepo/apps/gnosi/backend/api/zotero_routes.py`

---

## Mòduls

### A) Backup de la biblioteca Zotero
Mirall incremental de la carpeta `~/Zotero` cap a OneDrive.

- **Script:** `scripts/backup_zotero.sh`
- **Mecanisme:** `rsync -av --delete` (mirror exacte, esborra al destí els fitxers que ja no són a l'origen).
- **Origen:** `~/Zotero`
- **Destí:** `~/OneDrive/Backups/Zotero`
- **Log:** `~/backup_zotero.log`
- **Recuperació:** tancar Zotero i copiar del destí cap a la ruta local.

```bash
sh monorepo/apps/gnosi/pipeline/skills/zotero_sync/scripts/backup_zotero.sh
```

### B) Sincronització Zotero → Vault
Llegeix `zotero.sqlite` local i fa upsert d'ítems a la taula del Vault configurada.

- **Script:** `scripts/zotero_to_vault.py`
- **API consumida:** `http://localhost:8000/api/vault/pages` (POST/PUT)
- **Identitat de pàgina:** `metadata.zotero_key` (clau Zotero immutable).
- **Seguretat:** copia `zotero.sqlite` a `/tmp/zotero_sync_temp.sqlite` per llegir-lo encara que Zotero estigui obert.
- **Trigger:** `POST /api/zotero/sync` (subprocess, timeout 5 min).

### C) Sincronització Vault → Zotero
Llegeix les pàgines del Vault i actualitza camps a la `zotero.sqlite`.

- **Script:** `scripts/gnosi_to_zotero.py`
- **Pre-condició:** Zotero ha d'estar tancat (`pgrep -x Zotero` retorna != 0). En cas contrari l'API retorna `{"status": "zotero_open"}` i no llança el subprocess.
- **Trigger:** `POST /api/zotero/sync-back`.

---

## Configuració

Fitxer: `zotero_db_config.json` (mateixa carpeta de la skill).

```json
{
  "enabled": true,
  "zotero_db": "~/Zotero/zotero.sqlite",
  "target_table": "<uuid-taula-vault>",
  "mapping": {
    "title": "<uuid-property-1>",
    "creators": "<uuid-property-2>",
    "...": "..."
  }
}
```

> ⚠️ El `mapping` desa `property_id` (UUID immutable), **no** `property.name`. Així renombrar columnes des del UI no trenca el sync. La traducció `id → name` actual es fa al runtime contra el registry del Vault.

Endpoint de gestió: `GET/POST /api/zotero/config` — escriptura atòmica via `safe_write_json`.

---

## Restriccions i edge cases

- **Direccionalitat:** sync independents Z→G i G→Z; no hi ha resolució de conflictes automàtica encara (last-write-wins implícit).
- **Backup vs sync:** el backup mou tota la carpeta `~/Zotero`; no és necessari per al sync de metadata, que usa només `zotero.sqlite`.
- **Identitat fora de Zotero:** pàgines del Vault sense `zotero_key` queden invisibles per al sync (potencial duplicat). La Fase 3 del pla introduirà match per títol normalitzat.
- **Validació d'esquema:** el sync no valida tipus de propietat al Vault. Properties tipus `select`/`multi_select` poden rebre opcions no llistades. Pendent: pre-validació al Fase 1.

---

## Cicle d'aprenentatge

| Data | Error / Aprenentatge | Causa | Solució |
| --- | --- | --- | --- |
| 2026-02-09 | UnicodeDecodeError | Output de rsync | Decodificació segura al wrapper Python. |
| 2026-04-08 | Memòria fragmentada | Directius duplicats | Unificació (skill `zotero_management`). |
| 2026-05-09 | Skills duplicades | `zotero_sync` (API) i `zotero_management` (docs) divergien | Consolidació en aquesta skill canònica. |

---

*Manteniment: si Zotero canvia la ruta per defecte de la BD, actualitzar `zotero_db` al config i el camí per defecte a `zotero_routes.DEFAULT_CONFIG`.*

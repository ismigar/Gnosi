# Directori "zotero_sync" (històric — només manté config)

> **Aquest directori NO conté codi de sync.** El sync Zotero ↔ Vault es va
> eliminar quan Gnosi va passar a ser el gestor de referències natiu
> (vegis [`docs/dev_memory/directives/gnosi_native_reference_manager.md`](../../../../../docs/dev_memory/directives/gnosi_native_reference_manager.md)).

## Què sobreviu

- `zotero_db_config.json` — storage de la **designació de Taula de
  Referències** del Vault (`target_table` + `references_configured`).
  Llegit pel codi viu a [`backend/services/reference_table_config.py`](../../../backend/services/reference_table_config.py).

## Per què el nom no s'ha canviat

El path al JSON està codificat a producció dels usuaris existents. Renombrar
el directori requeriria migrar fitxers en runtime, una operació delicada.
El nom és, per tant, històric — no implica que el sync existeixi.

## Quins fitxers han estat eliminats i quan

Vegeu l'historial de git:

```bash
git log --diff-filter=D --summary -- pipeline/skills/zotero_sync/
```

Eliminats al cleanup del codi sync deprecated:
- `SKILL.md` (documentació del sync)
- `scripts/zotero_to_vault.py` (sync Z→V via subprocess)
- `scripts/gnosi_to_zotero.py` (sync V→Z)
- `scripts/backup_zotero.sh` (rsync de la biblioteca Zotero a OneDrive)
- `scripts/zotero_enrich.py` (migració inicial enrich-only)
- `scripts/zotero_migrate_annotations.py` (annotations PDF → Vault)

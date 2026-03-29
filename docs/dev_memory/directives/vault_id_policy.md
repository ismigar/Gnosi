# Directiva: Política d'Identificadors (IDs) del Vault

## Estàndard

El **camp canònic** d'identificació de qualsevol pàgina del sistema és **`id`**.

## Regles

1. **Totes** les pàgines (migrades de Notion, creades manualment, subitems...) han de tenir **exactament un camp `id`** al seu frontmatter.
2. Els camps `source_id` i `notion_id` es consideren **legacy/obsolets**. No s'han d'usar en cap creació nova.
3. El backend normalitza automàticament qualsevol `source_id` o `notion_id` → `id` en cada operació d'escriptura (POST, PUT, PATCH).
4. El frontend usa un `aliasMap` que fa fallback (`id` → `source_id` → `notion_id`) per visualitzar dades antigues, però el camp canònic sempre és `id`.
5. Al `vault_db_registry.json`, totes les taules han de declarar `"name": "id"` com a propietat.

## Restriccions / Edge Cases

- **Imports de Notion:** Els scripts de migració han de renombrar `notion_id` → `id` abans d'escriure el fitxer.
- **Duplicats:** Si una pàgina conté tant `id` com `source_id`/`notion_id`, es preserva `id` i s'elimina l'antic.
- **Subitems:** Els subitems creats des de la UI reben un UUID automàtic com a `id`.

## Fitxers rellevants

- **Backend (normalització):** `backend/api/vault_routes.py` → `normalize_metadata_ids()`
- **Frontend (aliasMap):** `frontend/src/components/Vault/VaultTable.jsx` → `aliasMap`
- **Registre:** `vault_db_registry.json` → `properties[].name: "id"`
- **Script de migració:** `pipeline/sandbox/migrate_ids.py`

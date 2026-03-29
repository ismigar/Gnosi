# DIRECTIVE: NOTION_RECURSOS_SELF_FILTER_AUDIT

> ID: 2026-03-10
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_self_filter_audit.py
> Last Update: 2026-03-10
> Status: DRAFT

---

## 1. Objectives and Scope

- Main Objective: Auditar coherencia de vistes incrustades amb filtre `{{self}}` a Recursos.
- Success Criteria:
  - Report JSON generat amb metriques i outliers.
  - Validacio de tags incrustats (`type`, `folder`, `filters`).
  - Deteccio de desajustos entre relacions esperades i vista incrustada disponible.

## 2. Input/Output (I/O) Specifications

### Inputs

- Environment Variables:
  - `gnosi_VAULT_PATH` o ruta equivalent al vault local.
- Source Files:
  - `<VAULT>/BD/Cervell Digital/Recursos/*.md`
  - `<VAULT>/BD/Cervell Digital/Notes/*.md`

### Outputs

- Generated Artifacts:
  - `monorepo/apps/gnosi/pipeline/.tmp/recursos_self_filter_audit/audit.json`
  - `monorepo/apps/gnosi/pipeline/.tmp/recursos_self_filter_audit/summary.md`

## 3. Logical Flow

1. Carregar entorn i localitzar carpeta del vault.
2. Parsejar frontmatter i body de Recursos i Notes.
3. Comptar embeds per recurs i validar tag/filters.
4. Comptar notes relacionades per `resource_ids`.
5. Generar outliers:
   - recurs amb embeds pero sense relacions.
   - recurs amb relacions pero sense embeds.
   - embeds sense filtre self o amb format invalid.
6. Escriure report i resum.

## 4. Restrictions and Edge Cases

- IDs normalitzats sempre sense guions i en lowercase.
- `resource_ids` pot ser llista o string.
- No modificar dades del vault (read-only audit).

## 5. Error Protocol and Learning

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 10/03/2026 | 71 recursos amb embeds pero 0 relacions notes detectades | Al dataset actual no hi ha registres a `Notes` amb `resource_ids` vinculats als recursos auditats | Classificar com gap de dades (no de format): embeddings i filtres son valids, cal poblar/normalitzar relacions `resource_ids` per obtenir resultats no buits. |

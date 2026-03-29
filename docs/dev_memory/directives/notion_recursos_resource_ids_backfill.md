# DIRECTIVE: NOTION_RECURSOS_RESOURCE_IDS_BACKFILL

> ID: 2026-03-10
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_resource_ids_backfill.py
> Last Update: 2026-03-10
> Status: DRAFT

---

## 1. Objectives and Scope

- Main Objective: Omplir/normalitzar `resource_ids` al frontmatter de Notes a partir de les relacions reals de Notion.
- Success Criteria:
  - Dry-run genera report JSON sense modificar fitxers.
  - Apply actualitza només Notes amb canvis i crea backup previ.
  - Els `resource_ids` resultants apunten a IDs locals de Recursos (no a IDs Notion).

## 2. Input/Output (I/O) Specifications

### Inputs

- Environment Variables:
  - `NOTION_TOKEN` (o equivalent compatible) per consultar API Notion.
  - `gnosi_VAULT_PATH` opcional si no es passa `--vault-path`.
- Required Arguments:
  - `--vault-path` o variable d'entorn equivalent.
- Optional Arguments:
  - `--notes-dir`, `--resources-dir`, `--report-path`, `--apply`, `--limit`.
- Source Files:
  - `<VAULT>/BD/Cervell Digital/Notes/*.md`
  - `<VAULT>/BD/Cervell Digital/Recursos/*.md`

### Outputs

- Generated Artifacts:
  - Report JSON amb comptadors i mostra de canvis.
  - En apply: backups en carpeta `.tmp/.../backups`.
- Console Output:
  - Resum final (`updated`, `unchanged`, `missing_notion_id`, `api_errors`).

## 3. Logical Flow

1. Carregar env i validar rutes de Notes/Recursos.
2. Indexar Recursos per `notion_id` normalitzat -> `id` local.
3. Per cada Nota amb `notion_id`:
   - Consultar pàgina Notion (`/v1/pages/{page_id}`).
   - Detectar propietats de tipus `relation`.
   - Agafar els IDs relacionats que existeixen al mapa de Recursos.
4. Escriure `resource_ids` (llista) al frontmatter de la Nota.
5. Persistir segons mode:
   - dry-run: només report.
   - apply: backup + sobreescriptura fitxer.

## 4. Restrictions and Edge Cases

- No modificar cap fitxer sense backup en mode apply.
- Si no hi ha `NOTION_TOKEN`, abortar amb missatge clar.
- Si una Nota no té `notion_id`, marcar com `skipped_missing_notion_id`.
- Si una relació de Notion no existeix al mapa local de Recursos, registrar-la com `unmapped_relation_id`.
- Al vault actual, molts Recursos no tenen `notion_id` explícit: usar `id` com a fallback canònic per mapar relacions.
- En resolució avançada, es pot intentar match per títol Notion->Recursos, pero només quan el títol local és únic (evitar col·lisions).
- Determinisme: ordenar sempre els `resource_ids` abans d'escriure.
- Si l'entorn porta variables TLS (`REQUESTS_CA_BUNDLE` / `SSL_CERT_FILE`) inconsistents, executar amb aquestes variables netejades.

## 5. Error Protocol and Learning

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 10/03/2026 | Outliers `embed_but_no_relations` després de normalitzar embeds | Notes sense `resource_ids`, tot i tenir embeds correctes a Recursos | Crear backfill de `resource_ids` des de Notion i re-auditar self-filter després d'aplicar. |
| 10/03/2026 | El backfill inicial no trobava mapatge de Recursos | El script assumia `notion_id` en Recursos, però el dataset usa sobretot `id` local | Adaptat mapatge: `notion_id` o fallback a `id`; smoke + full dry-run OK i apply executat. |
| 10/03/2026 | Persistència d'outliers després del backfill | Part de relacions de Notion no mapegen a Recursos locals (`unmapped_relation_ids`) | Mantenir registre d'unmapped al report i planificar conciliació d'IDs Notion->Recursos en una fase posterior. |
| 10/03/2026 | Millora limitada del gap de relacions | Match directe per ID recupera gran part, pero queden relacions Notion sense recurs local equivalent | Afegida opcio de conciliació per títol únic (resol 14 relacions, +8 notes actualitzades); mantenir la resta com deuda de dades. |

# DIRECTIVE: NOTION_RECURSOS_UNMAPPED_RECONCILE

> ID: 2026-03-10
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_unmapped_reconcile_candidates.py
> Last Update: 2026-03-10
> Status: DRAFT

---

## 1. Objectives and Scope

- Main Objective: Generar propostes de conciliacio per `unmapped_relation_ids` de Notion cap a Recursos locals.
- Success Criteria:
  - Report JSON amb candidats classificats per confiança.
  - Fitxer markdown resum amb recomptes i mostra.
  - Cap modificacio del vault (read-only).

## 2. Input/Output (I/O) Specifications

### Inputs

- Environment Variables:
  - `NOTION_TOKEN` obligatori.
- Required Arguments:
  - `--backfill-report` (JSON amb `unmapped_relation_ids`).
  - `--resources-dir` (carpeta Recursos locals).
- Optional Arguments:
  - `--output-json`, `--output-md`, `--limit`.

### Outputs

- Generated Artifacts:
  - JSON amb: ids no mapejats, títol Notion, candidats locals i score.
  - Markdown resum amb metriques globals.

## 3. Logical Flow

1. Carregar report de backfill i obtenir IDs no mapejats unics.
2. Indexar Recursos locals per titol normalitzat i variants (sense accents/puntuacio).
3. Consultar títol de cada ID Notion no mapejat.
4. Proposar candidats:
   - `exact_unique` si matx exacte unic.
   - `normalized_unique` si matx normalitzat unic.
   - `fuzzy_candidates` si no hi ha matx unic, conservant nomes candidats amb `score >= 0.70` i limitant la sortida al top 3 per score.
   - `ambiguous` si multiples candidats.
   - `no_match` si cap candidat.
5. Escriure JSON + resum markdown.

## 4. Restrictions and Edge Cases

- No aplicar canvis automatics en aquesta fase.
- Els resultats `fuzzy_candidates` son nomes suggeriments: requereixen llindar minim + revisio manual abans de qualsevol `--apply`.
- Si falla API Notion per un ID, registrar error i continuar.
- Si hi ha titols duplicats a Recursos, marcar com ambigu i no decidir.
- Determinisme: ordenar sempre IDs i candidats.

## 5. Error Protocol and Learning

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 10/03/2026 | Queden molts `unmapped_relation_ids` despres del backfill per ID i fallback per titol unic en notes | Relacions de Notion apunten a registres no presents o no alineats amb Recursos locals | Generar conciliacio assistida de candidats amb score per preparar validacio manual o fase d'aplicacio controlada. |
| 10/03/2026 | El matching exacte tenia low recall en la fase de conciliacio | Dependencia excessiva de coincidencia exacta/normalitzada en títols heterogenis | Afegir pas `fuzzy_candidates` (top 3, `score >= 0.70`) com a suggeriment per revisio manual abans d'aplicar. Resultat: 205 IDs -> 1 exact + 16 fuzzy, 0 API errors. |
# DIRECTIVE: NOTION_RECURSOS_UNMAPPED_RECONCILE

> ID: 2026-03-10
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_unmapped_reconcile_candidates.py
> Last Update: 2026-03-10
> Status: DRAFT

---

## 1. Objectives and Scope

- Main Objective: Generar propostes de conciliacio per `unmapped_relation_ids` de Notion cap a Recursos locals.
- Success Criteria:
  - Report JSON amb candidats classificats per confiança.
  - Fitxer markdown resum amb recomptes i mostra.
  - Cap modificacio del vault (read-only).

## 2. Input/Output (I/O) Specifications

### Inputs

- Environment Variables:
  - `NOTION_TOKEN` obligatori.
- Required Arguments:
  - `--backfill-report` (JSON amb `unmapped_relation_ids`).
  - `--resources-dir` (carpeta Recursos locals).
- Optional Arguments:
  - `--output-json`, `--output-md`, `--limit`.

### Outputs

- Generated Artifacts:
  - JSON amb: ids no mapejats, títol Notion, candidats locals i score.
  - Markdown resum amb metriques globals.

## 3. Logical Flow

1. Carregar report de backfill i obtenir IDs no mapejats unics.
2. Indexar Recursos locals per titol normalitzat i variants (sense accents/puntuacio).
3. Consultar títol de cada ID Notion no mapejat.
4. Proposar candidats:
   - `exact_unique` si matx exacte unic.
   - `normalized_unique` si matx normalitzat unic.
  - `fuzzy_candidates` si no hi ha matx unic, conservant nomes candidats amb `score >= 0.70` i limitant la sortida al top 3 per score.
   - `ambiguous` si multiples candidats.
   - `no_match` si cap candidat.
5. Escriure JSON + resum markdown.

## 4. Restrictions and Edge Cases

- No aplicar canvis automatics en aquesta fase.
- Els resultats `fuzzy_candidates` son nomes suggeriments: requereixen llindar minim + revisio manual abans de qualsevol `--apply`.
- Si falla API Notion per un ID, registrar error i continuar.
- Si hi ha titols duplicats a Recursos, marcar com ambigu i no decidir.
- Determinisme: ordenar sempre IDs i candidats.

## 5. Error Protocol and Learning

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 10/03/2026 | Queden molts `unmapped_relation_ids` despres del backfill per ID i fallback per titol unic en notes | Relacions de Notion apunten a registres no presents o no alineats amb Recursos locals | Generar conciliacio assistida de candidats amb score per preparar validacio manual o fase d'aplicacio controlada. |# DIRECTIVE: NOTION_RECURSOS_UNMAPPED_RECONCILE

> ID: 2026-03-10
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_unmapped_reconcile_candidates.py
> Last Update: 2026-03-10
> Status: DRAFT

---

## 1. Objectives and Scope

- Main Objective: Generar propostes de conciliacio per `unmapped_relation_ids` de Notion cap a Recursos locals.
- Success Criteria:
  - Report JSON amb candidats classificats per confiança.
  - Fitxer markdown resum amb recomptes i mostra.
  - Cap modificacio del vault (read-only).

## 2. Input/Output (I/O) Specifications

### Inputs

- Environment Variables:
  - `NOTION_TOKEN` obligatori.
- Required Arguments:
  - `--backfill-report` (JSON amb `unmapped_relation_ids`).
  - `--resources-dir` (carpeta Recursos locals).
- Optional Arguments:
  - `--output-json`, `--output-md`, `--limit`.

### Outputs

- Generated Artifacts:
  - JSON amb: ids no mapejats, títol Notion, candidats locals i score.
  - Markdown resum amb metriques globals.

## 3. Logical Flow

1. Carregar report de backfill i obtenir IDs no mapejats unics.
2. Indexar Recursos locals per titol normalitzat i variants (sense accents/puntuacio).
3. Consultar títol de cada ID Notion no mapejat.
4. Proposar candidats:
   - `exact_unique` si matx exacte unic.
   - `normalized_unique` si matx normalitzat unic.
   - `ambiguous` si multiples candidats.
   - `no_match` si cap candidat.
5. Escriure JSON + resum markdown.

## 4. Restrictions and Edge Cases

- No aplicar canvis automatics en aquesta fase.
- Si falla API Notion per un ID, registrar error i continuar.
- Si hi ha titols duplicats a Recursos, marcar com ambigu i no decidir.
- Determinisme: ordenar sempre IDs i candidats.

## 5. Error Protocol and Learning

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 10/03/2026 | Queden molts `unmapped_relation_ids` despres del backfill per ID i fallback per titol unic en notes | Relacions de Notion apunten a registres no presents o no alineats amb Recursos locals | Generar conciliacio assistida de candidats amb score per preparar validacio manual o fase d'aplicacio controlada. |
| 10/03/2026 | El matching exacte tenia low recall en la fase de conciliacio | Dependencia excessiva de coincidencia exacta/normalitzada en títols heterogenis | Afegir pas `fuzzy_candidates` (top 3, `score >= 0.70`) com a suggeriment per revisio manual abans d'aplicar. Resultat: 205 IDs -> 1 exact + 16 fuzzy, 0 API errors. |

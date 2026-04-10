# DIRECTIVE: GNOSI_MIGRATION_UNMAPPED_RECONCILE

> ID: 2026-04-07
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/notion_recursos_unmapped_reconcile_candidates.py
> Last Update: 2026-04-07
> Status: ACTIVE

---

## 1. Objectius i Abast

- **Objectiu Principal:** Generar propostes de conciliació per IDs de Notion no mapejats (`unmapped_relation_ids`) cap a Recursos locals de Gnosi.
- **Criteris d'Èxit:**
  - Report JSON amb candidats classificats per confiança.
  - Fitxer markdown resum amb recomptes i mostra.
  - Cap modificació del vault (read-only) en la fase de proposta.

## 2. Especificacions d'I/O

### Inputs
- **Variables d'Entorn:**
  - `NOTION_TOKEN`: Per consultar títols originals a l'API externa.
- **Arguments Requerits:**
  - `--backfill-report`: JSON amb `unmapped_relation_ids`.
  - `--resources-dir`: Carpeta de Recursos locals de Gnosi.

### Outputs
- **Artefactes Generats:**
  - JSON amb IDs no mapejats, títol original de Notion, candidats de Gnosi i score.
  - Markdown resum amb mètriques globals de la migració.

## 3. Flux Lògic

1. **Acquisició:** Carregar report de backfill i obtenir IDs no mapejats únics de la font externa.
2. **Indexació:** Indexar els Recursos locals de Gnosi per títol normalitzat i variants.
3. **Consulta Externa:** Consultar el títol de cada ID a l'API de Notion.
4. **Matching:** Proposar candidats a Gnosi:
    - `exact_unique`: Matx exacte únic.
    - `normalized_unique`: Matx normalitzat únic.
    - `fuzzy_candidates`: Candidats amb `score >= 0.70` (top 3).
    - `no_match`: Cap candidat trobat al vault.
5. **Persistència:** Escriure JSON + resum markdown a la carpeta de migració.

## 4. Restriccions i Casos de Cantonada

- **Seguretat:** No aplicar canvis automàtics; aquesta directiva és només per a conciliació i proposta.
- **Ambigüitat:** Si hi ha títols duplicats a Gnosi, marcar com ambigu i requerir revisió manual.
- **Límits API:** Si falla l'API de Notion per un ID, registrar l'error i continuar amb el següent.

## 5. Protocol d'Errors i Aprenentatge (Memòria Viva)

| Data | Error Detectat | Causa Arrel | Solució/Patch Aplicat |
| --- | --- | --- | --- |
| 10/03/2026 | Baix recall en matching exacte | Títols heterogenis a Notion vs Gnosi | Afegir `fuzzy_candidates` amb llindar de 0.70. |
| 07/04/2026 | Confusió d'identitat | Referències a Notion com a aplicació principal | Rebranding de la directiva: Notion és només la FONT, Gnosi és el DESTÍ. |

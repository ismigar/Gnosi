---
name: translate_gaps_implementation
description: Tancament dels forats (GAP 1-3) de la traducció de registres i pàgines — botó de fila, menú conscient del context, idempotència, traducció massiva i marcatge d'obsolescència.
type: directive
status: active
related:
  - translate_row_skill
  - translate_page_skill
  - feedback_local_backend_test_verification
  - feedback_vault_editor_qa_safety
---

# Directiva: completar la traducció de contingut (GAP 1-3)

Extensió de les skills `translate_row` i `translate_page`, que ja estaven completes al
backend però amb forats de UI i de cicle de vida. Aquesta directiva documenta el pla i
les restriccions apreses.

## Punt de partida (ja existent)

- Definició: `SchemaConfigModal` desa `translation_enabled` (taula) i `translatable`
  (camp) al registry.
- Endpoints `POST /api/vault/skills/translate-row` i `.../translate-page`: tradueixen i
  creen subitems/subpàgines amb `translation_lang / translation_source_lang /
  translation_origin_id`.
- `TranslateLanguagesModal`: selecció d'idiomes (mode `row` | `page`).
- El menú `···` de la pàgina ja tenia "Tradueix la pàgina" (sempre mode `page`).

## Forats tancats

### GAP 1 — Botó de traduir als botons d'acció de fila
El disparador només existia com a **columna** de tipus `button`. S'afegeix un botó a la
cel·la d'accions de cada fila (costat d'Obrir/Eliminar), visible només si
`translation_enabled` i si la fila **no** és ja una traducció (`!metadata.translation_lang`).

### GAP 2 — Menú de pàgina conscient del context
Quan la pàgina oberta és un **registre d'una taula traduïble**, el menú obre el modal en
`mode="row"` (tradueix camps → subitem). Si és una pàgina normal, `mode="page"` (títol +
cos → subpàgina). Decisió via `resolvePageTableId` + `translation_enabled` de la taula.

### GAP 3a — Idempotència
Re-traduir ja no duplica. Abans de crear, es busca la traducció existent per
`(translation_origin_id, translation_lang)` amb `find_translations_of`; si existeix,
s'actualitza (PATCH intern) i es neteja `translation_stale`.

### GAP 3b — Tests
Lògica pura a `backend/services/translation_helpers.py` (sense I/O ni imports de backend)
→ testable amb pytest sense Docker (`backend/tests/test_translation_helpers.py`).

### GAP 3c — Traducció massiva
`POST /api/vault/skills/translate-rows` (`item_ids[]`) i botó "Traduir" a
`VaultBulkActionsBar`. Reutilitza la funció interna per fila.

### GAP 3d — Marcatge d'obsolescència (sync)
En desar un original, un background task marca `translation_stale: true` a les seves
traduccions. **No regenera** (massa car/arriscat): només senyala que cal re-traduir
(que ja és idempotent).

## Restriccions / Edge cases (CRÍTIC)

- **No disparar escriptures amb l'autosave**: el marcatge stale té dues guardes —
  (a) la pàgina editada no pot ser ella mateixa una traducció (evita recursió), i
  (b) `translatable_content_changed` ha de ser cert (només canvis de camps traduïbles
  o de body/títol). Veure `feedback_vault_editor_qa_safety`.
- **Idempotent al marcatge**: `_set_page_metadata_flag` no reescriu si el flag ja hi és
  → evita tempestes de PATCH quan l'autosave repeteix.
- **No usar el rule engine ni l'etag** per marcar el flag intern: és una escriptura
  mínima (read → set flag → save_page_md → update cache), replicant el patró segur de
  `patch_page` sense els seus efectes secundaris.
- **Comparar IDs canònicament** (`canonicalize_id`): `translation_origin_id` pot estar
  desat amb o sense guions.
- **Testing local**: `python3.11` (no 3.9); l'import del backend sencer arrossega
  langgraph → mantenir la lògica a `services/` pura i importable.

## QA

1. `python3.11 -m py_compile` del backend tocat.
2. `python3.11 -m pytest backend/tests/test_translation_helpers.py -q`.
3. Build estàtic del frontend (symlink de node_modules al worktree).
4. Browser E2E: només possible sobre `~/Projectes` (main) — Docker/dev server no corren
   sobre el worktree. Verificar després de fusionar.

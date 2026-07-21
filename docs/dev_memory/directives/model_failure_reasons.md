# Directiva: per què falla un model (fiabilitat per motiu)

**Estat:** implementat com a **observabilitat**. No hi ha cap automatisme.

## Problema

Avisar que "aquest model va malament amb eines" a partir d'una llista clavada al
codi és fals de seguida: els models canvien, i sobretot **no totes les fallades
són del model**. Durant el QA del BOE, OpenRouter va respondre 402 (sense crèdit);
una llista negra ingènua n'hauria conclòs que gpt-4o-mini és dolent amb eines.

## Principi rector

**El motiu de la fallada decideix de qui és la culpa**, i només les fallades
atribuïbles al model són evidència *sobre el model*.

| Motiu | Culpa | Què vol dir |
|---|---|---|
| `tool_use_failed` | model | ha escrit la crida d'eina com a text |
| `context_length_exceeded` | model | no li cap la conversa |
| `schema_invalid` | model | no respecta el format demanat |
| `content_filter` | model | bloquejat pels seus filtres |
| `rate_limit` | compte | límit de peticions |
| `insufficient_credit` | compte | sense crèdit (402) |
| `auth` | compte | credencials |
| `not_found` | compte | el proveïdor no coneix el model |
| `timeout` / `server_error` | proveïdor | transitori |

`backend/agent/model_reliability.py`: `classify_failure()` (pura, per signatures
de text), `record_failure()` (ledger `cache/llm_failures.json`, per
provider:model → motiu → dia) i `reliability_report(window_days)`.

## Superfícies

- **Xat**: el missatge d'error diu el motiu en llenguatge planer i, si el motiu és
  del model i s'ha repetit, quantes vegades. Un `insufficient_credit` diu
  explícitament que **no és problema del model**.
- **Selector de model de l'agent** i **registre de models**: avís/badge només si
  `top_model_reason` no és nul, és a dir, només amb culpa del model.
- `GET /api/ai/model-reliability?window_days=30`.

## Restriccions / casos límit

- **Només observabilitat.** Res desactiva ni redirigeix cap model: l'usuari llegeix
  l'evidència i decideix. Si algun dia alimenta `route_model`, que sigui **només**
  amb motius de culpa del model i **només** per a la capacitat afectada
  (`tool_use_failed` → perd `tools`, no queda vetat del tot).
- **Cicle load→modify→save sota candau** (`_lock`) i escriptura atòmica, com a
  `UsageStore`: dos torns que fallen alhora es trepitjarien el recompte
  (cf. memòria `json_store_rmw_race_pattern`).
- **La comptabilitat no pot tombar la petició**: `record_failure` mai propaga.
- **Finestra mòbil de 30 dies**: una fallada de fa mesos no ha de pesar; un model
  s'arregla amb el temps.
- La clau és `provider:model_id`: **el mateix model a dos proveïdors es compta per
  separat**, que és el correcte — el suport d'eines depèn de qui el serveix.

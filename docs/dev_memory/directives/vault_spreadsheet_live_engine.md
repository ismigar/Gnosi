# DIRECTIVE: VAULT_SPREADSHEET_LIVE_ENGINE

> ID: 2026-03-12
Associated Script: monorepo/apps/gnosi/backend/server.py + monorepo/apps/gnosi/frontend/src/components/Vault/*.jsx
Last Update: 2026-03-12
Status: ACTIVE

---

## 1. Objectives and Scope

Implementar una funcionalitat de full de calcul viable al Vault amb recalcul automatic de camps formula i aplicacio de formules per defecte en crear registres.

- Main Objective: Recalcular camps formula en cada create/update de registre, incloent propagacio de dependencies dins del mateix registre.
- Success Criteria: Quan canvia un camp d'entrada, els camps formula dependents es recalculen i es persisteixen de forma deterministic.

## 2. Input/Output (I/O) Specifications

### Inputs

- Required runtime inputs:
  - Registry de taules i propietats via endpoints actuals de Vault.
  - Metadata de pagina enviada en POST/PUT/PATCH.
- Source files:
  - monorepo/apps/gnosi/backend/server.py
  - monorepo/apps/gnosi/frontend/src/components/Vault/formulaUtils.js
  - monorepo/apps/gnosi/frontend/src/components/Vault/defaultFormulaUtils.js

### Outputs

- Generated artifacts:
  - Metadata persistida amb valors de camps formula recalculats.
- Console output:
  - Logs d'error no bloquejants en cas de formula invalida.

## 3. Logical Flow (Algorithm)

1. Initialization: carregar schema de taula activa a partir de table_id/database_table_id del registre.
2. Dependency extraction: detectar dependencies de cada formula a partir de variables usades a l'expressio.
3. Ordered evaluation: construir ordre topologic i avaluar formules en aquest ordre.
4. Circular safety: si hi ha cicle o error de parse, no bloquejar el save i marcar valor buit del camp afectat.
5. Persistence: escriure metadata final amb camps formula recalculats.
6. Frontend feedback: reutilitzar la mateixa logica per mostrar valors mentre s'edita.

## 4. Tools and Libraries

- Backend: FastAPI stack actual, json, regex, utilitats internes.
- Frontend: expr-eval via formulaUtils existent.

## 5. Restrictions and Edge Cases

- No executar eval de Python o JS arbitrari.
- En dependencies circulars, evitar bucles infinits i retornar estat controlat.
- Les formules han d'ignorar camps no definits convertint-los a 0 o string buit segons context.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 12/03 | Build frontend de scope incorrecte | npm workspace script resolia build global | Executar build des de frontend directori |
| 12/03 | simpleeval fallava amb sintaxi `{camp}` | simpleeval no interpreta placeholders estil frontend | Nota: No usar `{camp}` directament en backend; transformar placeholders a tokens interns abans d'avaluar |
| 12/03 | Timeouts puntuals a API durant validació E2E | watchfiles auto-reload del backend mentre es modificaven fitxers | Evitar llançar E2E durant canvis actius; esperar backend estable després del reload |

## 7. Examples of Use

- Crear camp formula: `total = preu * quantitat`
- Editar `quantitat` en una fila i verificar recalc de `total` immediat i persistit.

## 8. Pre-Execution Checklist

- [ ] Registry carregat i accessible
- [ ] Build frontend en verd
- [ ] API backend operativa

## 9. Post-Execution Checklist

- [ ] Recalcul en create validat
- [ ] Recalcul en update validat
- [ ] Cas de cicle detectat i controlat
- [ ] Directiva actualitzada amb aprenentatges

## 10. Additional Notes

Implementacio incremental: primer dependencias intra-fila, despres agregacions inter-files.

# Directive: CONSOLIDATED_LOGGING_PROTOCOL

> ID: 2026-04-07
> Associated Script: monorepo/apps/gnosi/pipeline/sandbox/refactor_logging.py
> Last Update: 2026-04-07
> Status: ACTIVE

---

## 1. Objectives and Scope

- **Main Objective:** Eliminar tots els logs de depuració no essencials (`console.log` i `print`) i substituir-los per un sistema de logging estructurat on sigui necessari.
- **Success Criteria:** 
    - Zero `console.log` al codi de producció del frontend.
    - Zero `print()` al codi de la API/Backend (substituïts per `logger.info`, `error`, etc.).
    - Mantenir els `print()` només en scripts de terminal estrictament d'usuari (`scripts/`).

## 2. Input/Output (I/O) Specifications

### Inputs
- **Source Files:**
    - `monorepo/apps/gnosi/frontend/src/**/*`
    - `monorepo/apps/gnosi/backend/**/*.py`

## 3. Logical Flow (Algorithm)

1. **Audit:** Escanejar el monorepo buscant patrons de logs.
2. **Classification:**
    - **Trivial Logs:** Eliminar completament.
    - **Error Logs:** Convertir a `console.error` (frontend) o `logger.exception/error` (backend).
    - **Data Debugging:** Eliminar o convertir a `logger.debug`.
3. **Refactor:** Executar scripts de Python al `sandbox` per aplicar els canvis de forma massiva i segura.
4. **Verification:** Executar linter i build per assegurar que no hi ha regressions.

## 5. Restrictions and Edge Cases

- **CLI Tools:** Els scripts que estan pensats per ser executats manualment per consola poden mantenir `print` per a feedback d'usuari a temps real.
- **Production Build:** El build de Vite ja hauria de tenir regles per eliminar `console.log`, però els eliminarem de la font per netejar l'entorn de desenvolupament.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 07/04 | N/A | Inicialització | N/A |

# DIRECTIVE: DASHBOARD_ANALYTICS_DRILLDOWN

> ID: 2026-04-15
Associated Script: N/A (Frontend/Backend API) Last Update: 2026-04-15
Status: ACTIVE

---

## 1. Objectives and Scope

Millorar el Control Center (Dashboard) per oferir visibilitat detallada de les dades de mètriques, especialment els "Errors Evitats" (Traps).

- **Objective Principal:** Permetre que l'usuari vegi la llista detallada de trampes documentades en fer clic a la targeta d'Analytics.
- **Success Criteria:** En fer clic a "Errors Evitats", s'ha de mostrar un modal amb la llista de dates, trampes i solucions extretes de les directives.

## 2. Input/Output (I/O) Specifications

### Inputs

- **Source Files:**
    - `monorepo/apps/gnosi/backend/agent/instructions/*.md`: Fitxers de directives on es defineixen les traps.
- **Source Code:**
    - `monorepo/apps/gnosi/backend/api/analytics_routes.py`: Endpoint d'analytics.
    - `monorepo/apps/gnosi/frontend/src/pages/Dashboard.jsx`: Pàgina de dashboard.

### Outputs

- **Generated Artifacts:**
    - Nou endpoint `/api/analytics/traps`.
    - Modal de detall al frontend.

## 3. Logical Flow (Algorithm)

1. **Backend Extraction:**
    - Iterar per tots els fitxers `.md` a `backend/agent/instructions`.
    - Cercar taules markdown que comencin amb la secció `## Discovered Traps` o que continguin el patró `| YYYY-MM-DD |`.
    - Parsejar cada fila per extreure Data, Trap i Solució.
    - Retornar la llista com a JSON.
2. **Frontend Interaction:**
    - Afegir un `onClick` a la targeta d'Errors Evitats.
    - Obrir un modal que crida a l'endpoint de traps.
    - Mostrar les dades en una taula moderna i neta.

## 4. Tools and Libraries

- **Backend:** `FastAPI`, `pathlib`, `re`.
- **Frontend:** `React`, `Lucide Icons`.

## 5. Restrictions and Edge Cases

- **Format de Directives:** Si una directiva no segueix el format de taula estàndard, s'ha d'ignorar la fila errònia sense trencar l'API.
- **Performance:** L'extracció és síncrona però els fitxers són petits. Si creixen, caldrà cache.

## 6. Error Protocol and Learning (Live Memory)

| Date | Error Detected | Root Cause | Solution/Patch Applied |
| --- | --- | --- | --- |
| 15/04 | Incoherència visual | Falta de drill-down a analytics | Implementar modals de detall |

## 11. Post-Execution Checklist (Verification Gates)

- [ ]  Endpoint `/api/analytics/traps` retorna dades vàlides (6 items actualment).
- [ ]  El botó "Resum →" obre el modal correctament.
- [ ]  El build de frontend passa sense errors.
- [ ]  Prova visual al navegador confirmada.

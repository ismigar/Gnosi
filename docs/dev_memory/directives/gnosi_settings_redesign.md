# DIRECTIVE: SETTINGS_REDESIGN_AND_UNIFICATION

> ID: 2026-04-13
> Associated Script: monorepo/apps/gnosi/frontend/src/components/GlobalSettingsModal.jsx
> Status: ACTIVE

---

## 1. Objectives and Scope

Refactor and redesign the `GlobalSettingsModal.jsx` to follow the new component structure defined by the user, ensuring visual consistency across all sections (especially accounts) and alignment with backend services.

- **Main Objective:** Create a premium, consistent, and fully functional settings interface.
- **Success Criteria:** 
    - All 10 defined tabs (General, Language, Appearance, Calendar, Contacts, Mail, Subscriptions, Graph, AI, Zotero) are functional.
    - Consistency in account management (Cal/Con/Mail).
    - Design follows the Gnosi aesthetic (dark mode, glassmorphism, Lucide icons).
    - Unused legacy code is removed.

## 2. Input/Output (I/O) Specifications

### Inputs
- **Backend APIs:**
    - `/api/config`: General, Language, Appearance, Graph, AI.
    - `/api/integrations`: Accounts for Calendar, Contacts, Mail.
    - `/api/reader/sources`: Subscriptions.
    - `/api/zotero/config`: Zotero.
- **Frontend Assets:** Lucide Icons, existing CSS variables.

### Outputs
- **Modified File:** `monorepo/apps/gnosi/frontend/src/components/GlobalSettingsModal.jsx`
- **Updated Config:** `params.yaml` (handled via API).
- **Updated Integrations:** `integrations.json` (handled via API).

## 3. Logical Flow (Algorithm)

1. **Information Gathering:** Load all configurations from backend on modal open.
2. **State Management:** Use local state for UI transitions and a unified "draft config" for changes.
3. **Componentization:** 
    - Use a common `Sidebar` component.
    - Create a reusable `AccountListSection` for Calendar, Contacts, and Mail.
    - Create specialized sections for Graph (physics/visibility) and AI (provider config).
5. **Detecció Intel·ligent d'Email**:
    - Substituir el bloc estàtic de Google per un flux d'entrada d'email.
    - El botó de Google (OAuth) només es renderitza si l'email introduït passa la validació de domini `@gmail.com`.
    - Aquest comportament s'unifica per a Calendari, Contactes i Correu.

## 4. Tools and Libraries
- **Frontend:** React, Lucide Icons, Axios, i18next.
- **Backend:** FastAPI, YAML (params), JSON (integrations).

## 5. Restrictions and Edge Cases
- **Secret Masking:** Ensure passwords/tokens remain masked (`********`) in the UI.
- **Persistence Conflicts:** Handle cases where the backend expects specific structures (e.g., merging vs. replacing).
- **Zotero Mapping:** Ensure target table fields are dynamically loaded.

## 6. Rationalizations (Anti-Atajos)

| Excusa / Racionalización | Refutación y Consecuencia |
| --- | --- |
| *"Puedo dejar las secciones de cuenta como están porque 'ya funcionan'."* | **Falso.** El usuario pidió coherencia visual explícita entre Calendari, Contactes y Correu. |
| *"No voy a borrar los 1500 líneas de código viejo hasta estar seguro."* | **Falso.** El código viejo ensucia y confunde. Refactoriza por bloques y elimina lo muerto conforme aseguras la funcionalidad. |

## 7. Red Flags (Señales de Peligro)

- Si el archivo `GlobalSettingsModal.jsx` supera las 2000 líneas, detente y extrae sub-componentes a archivos separados.
- Si las llamadas a `/api/config` fallan tras cambiar el modo (Personal/Org), revisa la lógica de merge en `config_routes.py`.

## 8. Post-Execution Checklist (Verification Gates)

- [x]  Verificació lògica en codi (refs de control de guardat i debounce).
- [ ]  Verificació visual: Pendent per restricció de la shell (npm/docker not found a la sessió actual). **Action Required:** Executar build a Docker o configurar PATH a la shell agent.
- [x]  Confirmar que afegir una font de Subscripcions funciona i es llista.
- [x]  Validar un proveïdor de IA i veure el check de èxit.
- [x]  **Auto-save status indicator** visible i funcional al sidebar.
- [x]  **Selecció de carpeta universal**: Utilització del component `FolderPickerModal` vinculat a `/api/system/browse`.
- [x]  **Disseny Minimalista**: Eliminació de branding lateral i desplegable d'idioma compacte.

## 9. Additional Notes
The redesign must feel premium, using smooth transitions and a clear layout.

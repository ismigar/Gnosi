# Directiva de Prevenció de Regressions UI

## Objectiu
Mantenir l'estabilitat dels components clau de la interfície d'usuari (UI) del Gnosi, evitant que refactoritzacions globals (com canvis de tema o migracions de CSS) eliminen estils crítics de posicionament i visualització.

## Components Crítics

### 1. Modals de Configuració (Settings)
- **Patró**: Overlay de pantalla completa amb centrat flexible i desenfocament.
- **Classes Crítiques**:
    - `.settings-overlay`: `position: fixed`, `display: flex`, `justify-content: center`, `align-items: center`, `backdrop-filter: blur(4px)`.
    - `.settings-modal`: `width`, `height` (proporcional), `border-radius`, `box-shadow`.
- **Risc**: En refactoritzar el `:root` de `index.css`, NO eliminar aquestes classes. Si es mouen estils d'inline a CSS, assegurar-se que les classes estiguin ben definides amb `kebab-case`.

### 2. Barra Lateral (AppSidebar)
- **Mides**: Amplada fixa de `60px`.
- **Consistència**: L'ordre dels botons ha de coincidir exactament amb la Home Page.

## Protocol d'Execució
1. **Verificació Post-Canvi**: Sempre que s'editi `index.css`, cal obrir el modal de settings al navegador per confirmar que segueix centrat.
2. **Evitar Inline Styles**: Preferir classes a `index.css` per a posicionament global, facilitant la seva auditoria.

---
*Nota: Aquesta directiva s'ha creat després d'una regressió accidental on el refactor del tema va esborrar el centrat del modal.*

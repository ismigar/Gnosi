# Directive: Controls de Visualització del Graf

## Objectiu
Implementar i mantenir controls d'interfície per modificar l'aparença del graf (Sigma.js) dinàmicament.

## Arquitectura

### Flux de Dades
```
VisualizationSection (UI) -> GraphPage (State) -> GraphViewer (Renderer)
```

### Components Clau

1. **UI (`VisualizationSection.jsx`)**
   - Sliders i toggles dins d'una `CollapsibleSection`.
   - Props: `showArrows`, `nodeSize`, etc.

2. **Renderitzat (`GraphViewer.jsx`)**
   - **Sigma Settings**: Per atributs globals com `labelRenderedSizeThreshold`.
     ```javascript
     rendererRef.current.setSetting('labelRenderedSizeThreshold', value);
     ```
   - **Reducers**: Per atributs per element (node/edge).
     ```javascript
     // nodeReducer
     res.size = (data.size || 5) * nodeSizeRef.current;
     
     // edgeReducer
     if (!showArrowsRef.current) result.type = 'line';
     ```
   - **Ref Sync**: Cal usar `useRef` per accedir als valors actuals dins dels reducers sense reinicialitzar Sigma.

## Procediment per Afegir un Nou Control

1. **Crear l'estat**: A `GraphPage.jsx`.
2. **Afegir UI**: A `VisualizationSection.jsx`.
3. **Passar prop**: A `GraphViewer`.
4. **Sincronitzar Ref**: A `GraphViewer` (`const propRef = useRef(prop)` + `useEffect` per actualitzar).
5. **Implementar Lògica**:
   - Si és global: `useEffect` que crida `setSetting`.
   - Si és per element: Modificar `nodeReducer` o `edgeReducer` usant el `ref`.
6. **Refresh**: Sempre cridar `rendererRef.current.refresh()` després de canvis.

## Restriccions / Edge Cases

### ⚠️ Reinicialització vs Refresh
- **Refresh**: Actualitza posicions/colors/mides (ràpid).
- **Kill/New Sigma**: Reinicia tot el graf (lent, perd estat).
- **Regla**: Evitar reinicialitzar si només canvia aparença. Usar `refs` dins dels reducers.

### ⚠️ Reactivitat dels Reducers
Sigma no reactiva els reducers automàticament si canvien variables externes (closure).
**Solució**: Usar `useRef` mutable que els reducers llegeixen a cada frame.

## Fitxers Relacionats
- `frontend/src/components/VisualizationSection.jsx`
- `frontend/src/components/GraphViewer.jsx`
- `frontend/src/pages/GraphPage.jsx`

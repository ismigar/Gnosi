# Directive: Graph Visualization Controls

## Objective
Implement and maintain interface controls to dynamically modify the appearance of the graph (Sigma.js).

## Architecture

### Data Flow
```
VisualizationSection (UI) -> GraphPage (State) -> GraphViewer (Renderer)
```

### Key Components

1. **UI (`VisualizationSection.jsx`)**
   - Sliders and toggles inside a `CollapsibleSection`.
   - Props: `showArrows`, `nodeSize`, etc.

2. **Rendering (`GraphViewer.jsx`)**
   - **Sigma Settings**: For global attributes like `labelRenderedSizeThreshold`.
     ```javascript
     rendererRef.current.setSetting('labelRenderedSizeThreshold', value);
     ```
   - **Reducers**: For per-element attributes (node/edge).
     ```javascript
     // nodeReducer
     res.size = (data.size || 5) * nodeSizeRef.current;
     
     // edgeReducer
     if (!showArrowsRef.current) result.type = 'line';
     ```
   - **Ref Sync**: Use `useRef` to access current values within reducers without reinitializing Sigma.

---

## Procedure for Adding a New Control

1. **Create the state**: In `GraphPage.jsx`.
2. **Add UI**: In `VisualizationSection.jsx`.
3. **Pass prop**: To `GraphViewer`.
4. **Sync Ref**: In `GraphViewer` (`const propRef = useRef(prop)` + `useEffect` to update).
5. **Implement Logic**:
   - If global: `useEffect` that calls `setSetting`.
   - If per-element: Modify `nodeReducer` or `edgeReducer` using the `ref`.
6. **Refresh**: Always call `rendererRef.current.refresh()` after changes.

---

## Restrictions / Edge Cases

### ⚠️ Reinitialization vs Refresh
- **Refresh**: Updates positions/colors/sizes (fast).
- **Kill/New Sigma**: Restarts the entire graph (slow, loses state).
- **Rule**: Avoid reinitializing if only appearance changes. Use `refs` inside reducers.

### ⚠️ Reducer Reactivity
Sigma does not automatically reactivate reducers if external variables change (closure).
**Solution**: Use a mutable `useRef` that reducers read in every frame.

---

## Related Files
- `frontend/src/components/VisualizationSection.jsx`
- `frontend/src/components/GraphViewer.jsx`
- `frontend/src/pages/GraphPage.jsx`

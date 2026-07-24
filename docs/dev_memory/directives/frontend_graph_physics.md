# Directive: Controls of Physics of the Graph (Sigma/ForceAtlas2)

## Objective
Give control to the user over the spatial distribution of the graph through simulation physical parameters.

## Architecture and Stability (CRITICAL)

### 1. Debouncing (Anti-Crash)
The `ForceAtlas2` worker is taking too long to restart. If I send each change of the slider (hundreds of events per second), the worker becomes saturated and crashes the browser.
**Solution: Dual State Pattern**
```javascript
// A GraphPage.jsx
const [gravityUI, setGravityUI] = useState(0.05); // Feedback instantani al slider
const [gravity, setGravity] = useState(0.05);     // Valor real pel worker
const [edgeInfluenceUI, setEdgeInfluenceUI] = useState(0); // 0 = Màxima dispersió

useEffect(() => {
    const timer = setTimeout(() => setGravity(gravityUI), 300); // Debounce 300ms
    return () => clearTimeout(timer);
}, [gravityUI]);

// Passeu 'gravity' a GraphViewer, NO gravityUI
```

### 2. Edge Weight Influence (Dispersion)
By default, `ForceAtlas2` uses edge weights to attract nodes. If the weights are high (e.g., 80-100), not even a maximum repulsion of 50,000 will separate the nodes.
**Solution: Slider Influence**
- Add `edgeWeightInfluence` parameter to the configuration.
- **Value 0:** Ignore edge weights (Critical for effect "Cloud" / "obsidian-like").
- **Value 1:** Normal behavior.

### 3. Unlocked Ranges
The default values of the libraries are too conservative for large or dense graphs.
- **Repulsion (Scaling Ratio):** Allow up to **50,000** (or more).
- **Gravity:** Allow down to **0.00** (steps 0.01).

## Implementation Technical (GraphViewer.jsx)

```javascript
useEffect(() => {
    if (layoutRef.current) layoutRef.current.stop();

    const settings = {
        settings: {
            gravity: gravity,
            scalingRatio: repulsion, // Pot ser 50000+
            friction: friction,
            edgeWeightInfluence: edgeInfluence, // 0 = Màxima dispersió (cloud mode)
            // ...
        }
    };

    layoutRef.current = new ForceAtlas2(graph, settings);
    layoutRef.current.start();
}, [gravity, repulsion, friction, edgeInfluence]);
```

## Related Files
- `frontend/src/components/ForcesSection.jsx`
- `frontend/src/pages/GraphPage.jsx`
- `frontend/src/components/GraphViewer.jsx`

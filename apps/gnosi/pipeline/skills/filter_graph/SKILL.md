# Directive: Graph Physics Controls (Sigma/ForceAtlas2)

## Objective
Give the user control over the spatial distribution of the graph using physical simulation parameters.

## Architecture and Stability (CRITICAL)

### 1. Debouncing (Anti-Crash)
The `ForceAtlas2` worker takes time to restart. If we send every slider change (hundreds of events per second), the worker becomes saturated and hangs the browser.
**SOLUTION: Dual State Pattern**
```javascript
// In GraphPage.jsx
const [gravityUI, setGravityUI] = useState(0.05); // Instant slider feedback
const [gravity, setGravity] = useState(0.05);     // Actual value for the worker
const [edgeInfluenceUI, setEdgeInfluenceUI] = useState(0); // 0 = Maximum dispersion

useEffect(() => {
    const timer = setTimeout(() => setGravity(gravityUI), 300); // 300ms debounce
    return () => clearTimeout(timer);
}, [gravityUI]);

// Pass 'gravity' to GraphViewer, NOT gravityUI
```

### 2. Edge Weight Influence (Dispersion)
By default, `ForceAtlas2` uses edge weights to attract nodes. If weights are high (e.g., 80-100), even maximum repulsion (50,000) will not separate nodes.
**SOLUTION: Influence Slider**
- Add `edgeWeightInfluence` parameter to the configuration.
- **Value 0:** Ignores edge weights (Crucial for "Cloud" / "obsidian-like" effect).
- **Value 1:** Normal behavior.

### 3. Unlocked Ranges
The default library values are too conservative for large or dense graphs.
- **Repulsion (Scaling Ratio):** Allow up to **50,000** (or more).
- **Gravity:** Allow dropping to **0.00** (step 0.01).

## Technical Implementation (GraphViewer.jsx)

```javascript
useEffect(() => {
    if (layoutRef.current) layoutRef.current.stop();

    const settings = {
        settings: {
            gravity: gravity,
            scalingRatio: repulsion, // Can be 50000+
            friction: friction,
            edgeWeightInfluence: edgeInfluence, // 0 = Maximum dispersion (cloud mode)
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

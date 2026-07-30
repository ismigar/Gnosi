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

## Backend cache integrity

The global graph endpoint reads a per-vault dictionary cache. Scheduler
invalidation must reset both the graph values and their timestamps to empty
dictionaries. It must never assign `None`: graph construction calls `.get()`
on both caches and a `None` value makes `/api/graph` return HTTP 500, leaving
the interface empty.

For resilience during hot reloads or older in-memory state, `GraphService`
must normalize an invalid cache state to empty dictionaries before reading it.
Add a regression test that starts with both cache attributes set to `None` and
asserts graph construction still produces nodes.

## Filtered layout and minimap projection

The backend layout describes the complete vault, but the global graph often
renders a filtered table. Nodes that are isolated inside that filtered view
must not retain distant coordinates from the complete-vault orphan ring.
Arrange visible isolates deterministically in a multi-radius halo around the
visible connected component before fitting the camera. Avoid a perfect ring:
Obsidian distributes isolates at varied radii and the circular artifact makes
the layout look synthetic.

Camera navigation and the minimap must use Sigma's own normalization and
viewport conversion functions. Do not derive camera coordinates by scaling X
and Y independently from graph bounds: Sigma normalizes both axes with the
largest extent, and the manual projection drifts whenever the graph is not
square. Represent the camera as its actual viewport rectangle, not as a dot
that can be confused with a graph node. Minimap clicks must derive their zoom
from the visible-subset extent; a fixed absolute camera ratio refers to the
complete graph and can unexpectedly zoom far away from a filtered view.

Sigma v3 uses `labelRenderedSizeThreshold`. Do not use
`labelRenderThreshold`; the unknown setting is ignored and the default causes
hundreds of overview labels to overlap. Keep label density bounded at overview
zoom and let labels progressively appear when the user zooms in.

## Obsidian-style visible-subgraph refinement

The Forces controls must never be decorative. Load their persisted values from
`graph.physics`, enable the refinement pass, and run it only after filters have
set node and edge visibility. Building the physics subgraph before filters
causes hidden vault nodes to compress or displace the current table view.
The UI repulsion range is designed for ForceAtlas2 and must be scaled before it
is passed to `graphology-layout-force`; treating `1000` as a near-direct force
value explodes small visible graphs.

Sigma defaults `minEdgeThickness` to 1.7 pixels. This overrides small values
from the edge-thickness control and turns dense wikilink graphs into a solid
mass. Set an explicit sub-pixel minimum and use a low-opacity neutral base
color; reserve saturated edges for hover, pathfinding, and suggestions.

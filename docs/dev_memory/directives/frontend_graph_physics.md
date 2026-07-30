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
renders a filtered table. Do not reuse those coordinates or arrange filtered
isolates in a synthetic halo. Obsidian simulates every node in the current
sub-vault together, including disconnected components and isolates. Run one
visible-subgraph simulation over all of them before fitting the camera so the
overview preserves the natural component structure.

When comparing a filtered table with an Obsidian sub-vault, the topology must
also match the folder boundary. Render the body-wikilink edge set used by the
compared sub-vault; do not add database relation-property edges when Obsidian
does not include them, because they collapse disconnected components into the
main component. Represent genuinely unresolved wikilinks as scoped placeholder
nodes, and represent outgoing links to notes outside the selected table as
scoped placeholders. Hide a placeholder when its resolved target is visible
through the active filters. Incoming links from outside the table must not
leak into the filtered topology because Obsidian cannot discover them from
inside the sub-vault.

Use the compared sub-vault's `.obsidian/graph.json` as the diagnostic source
for force values. The default mapping uses the configured center strength,
the magnitude of the negative charge, a uniform link strength, and the stored
link distance. Node size must be derived from degree in the visible topology,
not degree in the complete backend graph.

Do not initialize the visible-subgraph simulation from the complete-vault
coordinates: filtered nodes inherit remote full-vault clusters and circular
orphan artifacts. Do not leave D3 to use its symmetric phyllotaxis fallback
either, because dense hubs settle into repeated crescents. Seed all visible
nodes deterministically over a disk using their stable IDs, then let the
visible links and forces refine that neutral starting distribution.

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

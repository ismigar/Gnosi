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

Connection proposals are a separate, scored edge layer. Read them directly
from the canonical Brain queue and add them only to the final response. They
must not influence structural metrics or frontend layout. The proposal writer
invalidates the graph response cache so an inbox dismissal or scheduled
proposal is visible on the next `/api/graph` request. Do not persist a graph
mirror or expose a second merge endpoint.

## Filtered layout and minimap projection

The backend does not calculate graph coordinates because the global graph
often renders a filtered table. Obsidian simulates every node in the current
sub-vault together, including disconnected components and isolates. Run one
visible-subgraph simulation over all of them before fitting the camera so the
overview preserves the natural component structure.

When comparing a filtered table with an Obsidian sub-vault, the topology must
also match the folder boundary. Render the body-wikilink edge set used by the
compared sub-vault. A body wikilink remains part of this set when the same edge
also belongs to a database-view relation, so export an explicit body-link
provenance flag. Do not add frontmatter-only relation edges when Obsidian does
not include them, because they collapse disconnected components into the main
component. Represent only genuinely unresolved wikilinks as placeholder nodes.
A table filter is a view of the same Gnosi vault, so a resolved target outside
the selected table stays resolved and must not generate a scoped placeholder.

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

Keep zero-degree nodes at their deterministic seeded positions and exclude
them as many-body charge sources. Letting global repulsion move every isolate
pushes them into a nearly perfect circular shell around the connected graph,
which is a layout artifact rather than Obsidian's scattered-isolate view.
Zero-degree nodes must also retain a clearly visible minimum size and a
high-contrast color in the complete graph. In isolate-only mode, increase that
minimum further and force labels independently of the global label threshold;
otherwise valid isolates look like missing data at overview zoom.
Highlighted and hovered note-title backgrounds must include horizontal and
bottom padding; a rectangle fitted directly to the text metrics makes the
title look clipped even when the glyphs technically fit.
Connected unresolved placeholders must still participate in the force field
and use a shorter link distance so unresolved wikilinks form compact radial
stars instead of long spokes.

Resolve stable-ID body wikilinks generated by Gnosi through page identity.
Only a target that matches neither a page ID nor a unique title/path target is
unresolved. Treating a valid internal ID as a missing filename creates
artificial placeholder stars around managed Brain indexes.

Camera navigation and the minimap must use Sigma's own normalization and
viewport conversion functions. Do not derive camera coordinates by scaling X
and Y independently from graph bounds: Sigma normalizes both axes with the
largest extent, and the manual projection drifts whenever the graph is not
square. Represent the camera as its actual viewport rectangle, not as a dot
that can be confused with a graph node. Minimap clicks must derive their zoom
from the visible-subset extent; a fixed absolute camera ratio refers to the
complete graph and can unexpectedly zoom far away from a filtered view.
Do not clip the camera rectangle to the visible-node bounds: when the main
viewport includes empty space, clipping removes one or more borders and makes
the frame look broken. Build the minimap transform from the union of the
visible-node bounds and Sigma's four viewport corners, then redraw both the
nodes and the complete camera rectangle when the camera changes.

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

Normalize the edge-thickness control around `1.0x`: its base rendered width is
`0.48`, which is 1.6 times the original `0.3` width. Keep persisted settings and
the displayed default at `1.0`; the multiplier expresses variation around the
new visual baseline rather than exposing an implementation migration to users.

## Filter panel defaults

The dynamic field-value filter can contain many values and must start
collapsed. Keep the table selector collapsed too; do not pass `defaultOpen` to
either filter's `CollapsibleSection` because its component default is collapsed.

## Validation

Run frontend checks from `frontend/`, but execute backend graph tests from
`backend/` with the repository virtual environment. Do not invoke a backend
test path from the frontend directory, because pytest cannot discover the file
and reports a false validation failure; use the backend working directory
instead.
Likewise, use paths relative to the selected working directory for frontend
inspection commands; prefixing them again with `monorepo/apps/gnosi/frontend/`
points to a nonexistent nested directory.

## Interaction controls

Only display a color grouping control when the current graph response contains
that grouping. Do not leave a selectable AI-cluster control with no
`ai_cluster` values, because it produces no visible effect and looks broken.
Color group controls must be reversible: toggling the active group restores
the normal node colors.
When conditionally rendering a color control with JSX `&&`, close both the
element and the expression. A missing closing brace turns the following panel
markup into an unterminated expression and prevents Vite from building.

The graph canvas and filter sidebar both consume wheel input. Stop wheel event
propagation at the sidebar and contain its overscroll so a user interacting
with its filters scrolls the sidebar, never Sigma's camera. Provide focus
shortcuts with Cmd/Ctrl+Shift+P for the panel and Cmd/Ctrl+Shift+G for the
graph; Cmd/Ctrl+Shift+C cycles the available color modes.

Graph responses can be served from cache too quickly for a loading state to be
perceived. Keep the loading overlay visible for at least 900 milliseconds and
expose real progress stages with a determinate, accessible bar. The lazy route
fallback, authentication bootstrap, and graph data loader must reuse the same
visual component. The bootstrap and route phases are indeterminate because they
expose no percentage; the data phase becomes determinate. Give the track and
fill explicit global theme colors so the first render does not depend on a
graph-scoped CSS alias. Keep this state visually minimal: one small, generic
loading label and the progress bar, without decorative imagery or a second
status slogan. Do not retain a global refresh button that only duplicates GET
`/api/graph` and reloads the complete page.

Keep the table filter collapsed when the graph opens. The active-filter badge
already communicates its state, while the collapsed default preserves vertical
space for the graph controls used more frequently.

Semantic proposals are a viewport-synchronized canvas overlay over Sigma, not
Graphology edges. Drawing them inside the structural graph makes similarity
filters contaminate isolation, hover, pathfinding, degree, and physics. Derive
the overlay from the currently visible structural nodes, redraw it after each
Sigma render, and expose a boolean visibility control only when the transport
contains proposal edges. The canonical Brain queue has no measured similarity
score, so do not display or filter by a fabricated percentage. Use a visually
distinct dashed purple stroke and keep the connection list and legend count
aligned with the same visible proposal set.

## Visible topology consistency

Isolation, hover neighbors, node sizing, and highlighted edges must all use
the same filtered topology shown by Sigma. Do not use `graph.degree()` or
`graph.neighbors()` directly for these interactions: those APIs include hidden
edges and nodes from the backing graph. First resolve visible candidate nodes
and renderable edges, then classify isolation from the endpoints of those
edges. Hover must traverse only edges whose `hidden` attribute is false and
must ignore hidden neighbors.

Hover edge styling must override the raw transport `size` for every edge. A
non-neighbor edge that inherits the backend size (`1` or `1.5`) becomes thicker
than the normalized visual baseline and makes the whole graph look selected.
Use the same normalized thickness helper for normal and dimmed edges; reserve
the stronger color, size, opacity, and z-index exclusively for direct one-hop
edges.

“Hide isolated nodes” and “Show only isolated nodes” are mutually exclusive
modes. Keep both controls visible so switching modes is explicit, and have each
activation clear the other state. The filter utility must still handle stale
state defensively by giving “show only” precedence; applying both predicates
independently removes every node and produces an unexplained empty graph.

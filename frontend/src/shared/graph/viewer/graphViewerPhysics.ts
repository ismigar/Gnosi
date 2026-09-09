import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { seededUnitInterval } from './graphViewerModel';
import type { ViewerGraph, ViewerOptions } from './types';
export interface LayoutNode {
    id: string;
    radius: number;
    unresolved: boolean;
    isolated: boolean;
    x: number;
    y: number;
    fx?: number;
    fy?: number;
}
export interface LayoutLink {
    source: string | LayoutNode;
    target: string | LayoutNode;
    weight: number;
    unresolved: boolean;
}

export interface VisibleLayout {
    nodes: LayoutNode[];
    links: LayoutLink[];
    nodeById: Map<string, LayoutNode>;
    degreeById: Map<string, number>;
}

/** Build D3's visible inputs without duplicating the Graphology projection. */
export function buildVisibleLayout(graph: ViewerGraph): VisibleLayout | null {
    const nodes: LayoutNode[] = [];
    const nodeById = new Map<string, LayoutNode>();
    graph.forEachNode((node, attrs) => {
        if (!attrs.hidden) {
            const item: LayoutNode = {
                id: node,
                radius: attrs.size || 5,
                unresolved: attrs.kind === 'unresolved',
                isolated: false,
                x: 0,
                y: 0,
            };
            nodes.push(item);
            nodeById.set(node, item);
        }
    });
    if (nodes.length === 0) return null;

    const links: LayoutLink[] = [];
    const degreeById = new Map<string, number>();
    const targetsBySource = new Map<string, Set<string>>();
    graph.forEachEdge((_edge, attrs, source, target) => {
        if (attrs.hidden || !nodeById.has(source) || !nodeById.has(target)) return;
        // The previous mixed subgraph used addEdge (directed by default).
        // Preserve the first ordered pair, reverse links, and degree-2 loops.
        let targets = targetsBySource.get(source);
        if (targets?.has(target)) return;
        if (!targets) {
            targets = new Set();
            targetsBySource.set(source, targets);
        }
        targets.add(target);
        links.push({
            source,
            target,
            weight: Number(attrs.weight || 1),
            unresolved: Boolean(attrs.unresolved),
        });
        degreeById.set(source, (degreeById.get(source) ?? 0) + 1);
        degreeById.set(target, (degreeById.get(target) ?? 0) + 1);
    });
    const seedRadius = Math.max(240, Math.sqrt(nodes.length) * 25);
    nodes.forEach((node) => {
        const degree = degreeById.get(node.id) ?? 0;
        degreeById.set(node.id, degree);
        const angle = seededUnitInterval(`${node.id}:angle`) * Math.PI * 2;
        const radius = Math.sqrt(seededUnitInterval(`${node.id}:radius`)) * seedRadius;
        node.isolated = degree === 0;
        node.x = Math.cos(angle) * radius;
        node.y = Math.sin(angle) * radius;
        // Keep the original deterministic placement and pin only isolates.
        if (node.isolated) {
            node.fx = node.x;
            node.fy = node.y;
        }
    });
    return { nodes, links, nodeById, degreeById };
}

export function createPhysics(graph: ViewerGraph, options: ViewerOptions) {
    const { gravity, strongGravityMode, repulsion, friction, linLogMode, edgeInfluence, outboundAttractionDistribution } = options;
    const layout = buildVisibleLayout(graph);
    if (!layout) return null;
    const { nodes: simulationNodes, links: simulationLinks, nodeById: simulationNodeById, degreeById } = layout;
    const centerStrength = Math.min(1, Math.max(0, gravity * 5.18713248970312 * (strongGravityMode ? 1.35 : 1)));
    // Normalize Gnosi's legacy 0-1000 control to D3 graph-space and clamp
    // close encounters so dense hubs do not collapse into one point.
    const chargeStrength = -Math.max(1, repulsion / 50);
    const velocityDecay = Math.min(0.9, Math.max(0.1, 0.2 + friction / 50));
    const resolvedLinkDistance = linLogMode ? 300 : 250;
    // Compact unresolved UUID leaves into the small radial stars visible in
    // Obsidian instead of giving them the full distance between real notes.
    const unresolvedLinkDistance = resolvedLinkDistance / 4;
    const centeringStrength = centerStrength * 0.06;
    const linkForce = forceLink<LayoutNode, LayoutLink>(simulationLinks)
        .id(node => node.id)
        .distance(link => (link.unresolved ? unresolvedLinkDistance : resolvedLinkDistance))
        .strength((link) => {
        const weightedStrength = edgeInfluence > 0
            ? Math.pow(Math.max(0.01, link.weight), edgeInfluence)
            : 1;
        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
        const degreeDivisor = outboundAttractionDistribution
            ? degreeById.get(sourceId) ?? 0
            : Math.min(degreeById.get(sourceId) ?? 0, degreeById.get(targetId) ?? 0);
        return weightedStrength / Math.max(1, degreeDivisor);
    });
    const simulation = forceSimulation(simulationNodes)
        .force('link', linkForce)
        .force('charge', forceManyBody<LayoutNode>()
        .strength(node => (node.isolated ? 0 : chargeStrength))
        .distanceMin(30))
        .force('center', forceCenter(0, 0))
        .force('centerX', forceX<LayoutNode>(0).strength(centeringStrength))
        .force('centerY', forceY<LayoutNode>(0).strength(centeringStrength))
        .force('collision', forceCollide<LayoutNode>(node => node.radius * 1.5 + 1).strength(0.7))
        .velocityDecay(velocityDecay)
        .stop();
    return { simulation, simulationNodeById };
}

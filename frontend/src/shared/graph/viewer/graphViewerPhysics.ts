import Graph from 'graphology';
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force';
import { seededUnitInterval } from './graphViewerModel';
import type { ViewerGraph, ViewerOptions } from './types';
interface LayoutAttributes {
    x: number;
    y: number;
    size: number;
    unresolved: boolean;
}
interface LayoutEdge {
    [key: string]: unknown;
    weight?: unknown;
    unresolved?: unknown;
}
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
interface LayoutLink {
    source: string | LayoutNode;
    target: string | LayoutNode;
    weight: number;
    unresolved: boolean;
}
export function createPhysics(graph: ViewerGraph, options: ViewerOptions) {
    const { gravity, strongGravityMode, repulsion, friction, linLogMode, edgeInfluence, outboundAttractionDistribution } = options;
    // Builds a subgraph with ONLY visible nodes and their connections
    const subG = new Graph<LayoutAttributes, LayoutEdge>();
    graph.forEachNode((node, attrs) => {
        if (!attrs.hidden) {
            subG.addNode(node, {
                x: attrs.x || 0,
                y: attrs.y || 0,
                size: attrs.size || 5,
                unresolved: attrs.kind === 'unresolved',
            });
        }
    });
    graph.forEachEdge((_edge, attrs, source, target) => {
        if (!attrs.hidden && subG.hasNode(source) && subG.hasNode(target) && !subG.hasEdge(source, target)) {
            subG.addEdge(source, target, attrs);
        }
    });
    if (subG.order === 0)
        return null;
    const simulationNodes: LayoutNode[] = [];
    const simulationNodeById = new Map<string, LayoutNode>();
    subG.forEachNode((node, attrs) => {
        const angle = seededUnitInterval(`${node}:angle`) * Math.PI * 2;
        const seedRadius = Math.max(240, Math.sqrt(subG.order) * 25);
        const radius = Math.sqrt(seededUnitInterval(`${node}:radius`)) * seedRadius;
        const isolated = subG.degree(node) === 0;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const item = {
            id: node,
            radius: attrs.size || 2,
            unresolved: attrs.unresolved,
            isolated,
            x,
            y,
            // Obsidian keeps isolates scattered around the canvas. Pinning
            // only zero-degree nodes prevents global repulsion from
            // arranging them into an artificial circular shell.
            ...(isolated ? { fx: x, fy: y } : {}),
        };
        simulationNodes.push(item);
        simulationNodeById.set(node, item);
    });
    const simulationLinks: LayoutLink[] = [];
    subG.forEachEdge((_edge, attrs, source, target) => {
        simulationLinks.push({
            source,
            target,
            weight: Number(attrs.weight || 1),
            unresolved: Boolean(attrs.unresolved),
        });
    });
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
            ? subG.degree(sourceId)
            : Math.min(subG.degree(sourceId), subG.degree(targetId));
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

import type { VaultGraphData, VaultGraphEdge, VaultGraphNode } from '../../shared/api/graph';
import type { ViewerOptions } from './types';
export function fixtureNode(key: string, overrides: Partial<VaultGraphNode> = {}): VaultGraphNode {
    return { key, id: key, label: key, kind: 'Wiki', cluster: null, color: '#123456', database_id: null, table_id: null, metadata: {}, path: `${key}.md`, size: 8, ...overrides };
}
export function fixtureEdge(source: string, target: string, overrides: Partial<VaultGraphEdge> = {}): VaultGraphEdge {
    return { id: `${source}-${target}`, source, target, src: source, dst: target, kind: 'link', color: '#aaa', body_link: true, dashed: false, directed: true, size: 1, unresolved: false, ...overrides };
}
export function fixtureData(): VaultGraphData {
    return { nodes: [fixtureNode('a'), fixtureNode('b'), fixtureNode('isolated')], edges: [fixtureEdge('a', 'b')], legend: { kinds: [], clusters: [] } };
}
export function fixtureOptions(overrides: Partial<ViewerOptions> = {}): ViewerOptions {
    return { graphData: fixtureData(), filters: {}, isPhysicsEnabled: false, showArrows: true, labelThreshold: 14, nodeSize: 1, edgeThickness: 1, gravity: 1, repulsion: 1000, friction: 1, edgeInfluence: 1, linLogMode: true, strongGravityMode: false, outboundAttractionDistribution: false, ...overrides };
}

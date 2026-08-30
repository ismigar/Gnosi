import type { Ref, RefObject } from 'react';
import type Graph from 'graphology';
import type Sigma from 'sigma';
import type { VaultGraphData } from '../../api/graph';
import type { applyFilters, FilterGraph, GraphEdgeAttributes as FilterEdgeAttributes } from '../../../utils/graphFilters';
import type { SemanticEdge } from '../model/semanticOverlay';
type FilterNodeAttributes = Parameters<Parameters<FilterGraph['forEachNode']>[0]>[1];
export interface ViewerNode extends FilterNodeAttributes {
    x: number;
    y: number;
    hidden?: boolean;
    size?: number;
    color?: string;
    borderColor?: string;
    fontColor?: string;
    isolated?: boolean;
    url?: string;
}
export interface ViewerEdge extends FilterEdgeAttributes {
    body_link?: boolean;
}
export type ViewerGraph = Graph<ViewerNode, ViewerEdge>;
export type ViewerRenderer = Sigma<ViewerNode, ViewerEdge>;
export interface ViewerFilters extends NonNullable<Parameters<typeof applyFilters>[1]> {
    pathResult?: {
        nodes: ReadonlySet<string>;
        edges: ReadonlySet<string>;
    } | null;
    showSemanticSuggestions?: boolean;
}
export interface GraphViewerHandle {
    zoomIn(): void;
    zoomOut(): void;
    center(): void;
    fullscreen(): void;
    panTo(x: unknown, y: unknown, ratio?: number): void;
    panToGraphPoint(x: unknown, y: unknown, ratio?: number): void;
    panToNode(nodeId: string, ratio?: number | null): void;
}
export interface ViewerConfig {
    colors?: {
        node_types?: Record<string, {
            bg?: string;
            border?: string;
            font?: string;
        }>;
    };
}
export interface GraphViewerProps {
    ref?: Ref<GraphViewerHandle> | RefObject<Pick<GraphViewerHandle, 'center' | 'zoomIn' | 'zoomOut'> | null>;
    graphData?: VaultGraphData | null;
    setGraphInstance?: (graph: ViewerGraph) => void;
    setRendererInstance?: (renderer: ViewerRenderer | null) => void;
    filters?: ViewerFilters;
    onNodeClick?: (node: string) => void;
    onNodeHover?: (node: string | null) => void;
    isDarkMode?: boolean;
    isPhysicsEnabled?: boolean;
    colorMode?: string;
    config?: ViewerConfig;
    isPathfindingMode?: boolean;
    pathSource?: string | null;
    pathTarget?: string | null;
    onSelectPathNode?: (node: string) => void;
    showArrows?: boolean;
    labelThreshold?: number;
    nodeSize?: number;
    edgeThickness?: number;
    gravity?: number;
    repulsion?: number;
    friction?: number;
    edgeInfluence?: number;
    linLogMode?: boolean;
    strongGravityMode?: boolean;
    outboundAttractionDistribution?: boolean;
}
export type ViewerOptions = GraphViewerProps & Required<Pick<GraphViewerProps, 'showArrows' | 'labelThreshold' | 'nodeSize' | 'edgeThickness' | 'gravity' | 'repulsion' | 'friction' | 'edgeInfluence' | 'linLogMode' | 'strongGravityMode' | 'outboundAttractionDistribution'>>;
export interface ViewerRuntime {
    graph: ViewerGraph | null;
    renderer: ViewerRenderer | null;
    clearHover: ((refresh?: boolean) => void) | null;
    semanticEdges: SemanticEdge[];
}
export type RuntimeRef = RefObject<ViewerRuntime>;
export type ContainerRef = RefObject<HTMLDivElement | null>;
export type OptionsRef = RefObject<ViewerOptions>;

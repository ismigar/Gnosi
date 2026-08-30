import type { NodeDisplayData, EdgeDisplayData } from 'sigma/types';
import { getHoverEdgeStyle, getRenderedEdgeThickness } from '../model/graphEdgeStyles';
import { stringToColor } from './graphViewerModel';
import type { OptionsRef, ViewerNode, ViewerEdge, ViewerOptions } from './types';
export interface HoverState {
    node: string | null;
    distances: Record<string, number>;
    edges: Set<string>;
}
type NodeStyle = Partial<NodeDisplayData> & {
    opacity?: number;
    borderColor?: string;
    fontColor?: string;
    labelColor?: string;
};
export function createReducers(options: OptionsRef, hover: HoverState, initial: ViewerOptions) {
    const { config, pathSource, pathTarget } = initial;
    const nodeReducer = (node: string, data: ViewerNode): Partial<NodeDisplayData> => {
        if (data.hidden)
            return { ...data, hidden: true, label: "" };
        const res: NodeStyle = { ...data };
        // Pathfinding Highlighting
        const pathResult = options.current.filters?.pathResult;
        if (pathResult) {
            const isInPath = pathResult.nodes.has(node);
            if (isInPath) {
                res.opacity = 1;
                res.zIndex = 20;
                res.highlighted = true;
                if (node === pathSource)
                    res.color = '#e67e22';
                else if (node === pathTarget)
                    res.color = '#27ae60';
            }
            else {
                res.opacity = 0.1;
                res.label = "";
                res.zIndex = 0;
            }
            return res;
        }
        else if (options.current.isPathfindingMode) {
            if (node === options.current.pathSource || node === options.current.pathTarget) {
                res.highlighted = true;
                res.zIndex = 20;
                res.color = node === options.current.pathSource ? '#e67e22' : '#27ae60';
                res.borderColor = '#fff';
                res.size = (data.size || 3) * 1.5;
            }
            else if (options.current.pathSource) {
                res.opacity = 0.6;
            }
        }
        if (options.current.colorMode === 'cluster' && data.cluster) {
            res.color = stringToColor(data.cluster);
            res.borderColor = res.color;
        }
        else if (data.kind === 'unresolved') {
            res.color = options.current.isDarkMode ? '#94a3b8' : '#cbd5e1';
            res.borderColor = res.color;
            res.fontColor = options.current.isDarkMode ? '#cbd5e1' : '#64748b';
        }
        else {
            if (config && config.colors && config.colors.node_types) {
                const nodeType = data.kind || 'default';
                const typeConfig = config.colors.node_types[nodeType] || config.colors.node_types.default;
                if (typeConfig) {
                    res.color = typeConfig.bg;
                    res.borderColor = typeConfig.border;
                    res.fontColor = typeConfig.font;
                }
            }
        }
        // Degree-zero nodes need an explicit visual treatment: their
        // topology-derived size is otherwise sub-pixel and they disappear
        // against the canvas, especially in dark mode. Keep them distinct
        // in the complete graph and force labels in isolate-only mode.
        if (data.isolated) {
            res.color = options.current.isDarkMode ? '#60a5fa' : '#2563eb';
            res.borderColor = options.current.isDarkMode ? '#bfdbfe' : '#1e3a8a';
            res.fontColor = options.current.isDarkMode ? '#ffffff' : '#0f172a';
            res.opacity = 1;
            res.zIndex = options.current.filters?.onlyIsolated ? 12 : 4;
            res.forceLabel = options.current.filters?.onlyIsolated;
        }
        const isDark = Boolean(options.current.isDarkMode);
        res.labelColor = isDark ? "#ffffff" : "#000000";
        res.label = data.label || "";
        if (hover.node) {
            const d = hover.distances[node] ?? 99;
            if (d <= 1) {
                res.opacity = 1;
                res.label = data.label;
                res.zIndex = 10;
            }
            else {
                res.opacity = 0.1;
                res.label = "";
                res.zIndex = 0;
            }
            if (node === hover.node)
                res.highlighted = true;
        }
        else if (options.current.filters?.selectedNode && node === options.current.filters.selectedNode) {
            res.highlighted = true;
            res.zIndex = 10;
        }
        // Apply node size multiplier from visualization controls
        if (options.current.nodeSize !== 1.0) {
            res.size = (res.size || data.size || 5) * options.current.nodeSize;
        }
        return res;
    };
    const edgeReducer = (edge: string, attributes: ViewerEdge): Partial<EdgeDisplayData> & {
        opacity?: number;
    } => {
        const data = { ...attributes, hidden: Boolean(attributes.hidden) };
        if (data.hidden)
            return { ...data, hidden: true };
        const isDark = Boolean(options.current.isDarkMode);
        const baseColor = isDark
            ? '#475569'
            : '#d9dde3';
        const color = baseColor;
        const thickness = options.current.edgeThickness || 1.0;
        const pathResult = options.current.filters?.pathResult;
        if (pathResult) {
            if (pathResult.edges.has(edge))
                return { ...data, color: "#3498db", size: 3, zIndex: 20 };
            else
                return { ...data, color: options.current.isDarkMode ? "rgba(255, 255, 255, 0.02)" : "rgba(0, 0, 0, 0.02)", opacity: 0.1, zIndex: 0 };
        }
        if (hover.node) {
            return {
                ...data,
                ...getHoverEdgeStyle({
                    isHovered: hover.edges.has(edge),
                    isDark,
                    multiplier: thickness,
                }),
            };
        }
        // Apply edge thickness multiplier and arrow toggle from visualization controls
        const result: Partial<EdgeDisplayData> = {
            ...data,
            color,
            type: options.current.showArrows ? 'arrow' : 'line',
            zIndex: 1
        };
        result.size = getRenderedEdgeThickness(thickness);
        return result;
    };
    return { nodeReducer, edgeReducer };
}

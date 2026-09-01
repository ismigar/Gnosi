import type { Settings } from 'sigma/settings';
import type { NodeDisplayData } from 'sigma/types';
import type { OptionsRef, ViewerNode, ViewerOptions, ViewerGraph } from './types';
import type { HoverState } from './graphViewerReducers';
import { createReducers } from './graphViewerReducers';
// Retain legacy settings verbatim: Sigma 3 ignores its historical labelRenderer
// and arrow-size options; renaming them here would change visible rendering.
interface LegacySettings extends Partial<Settings<ViewerNode, ReturnType<ViewerGraph['getEdgeAttributes']>>> {
    renderEdges: boolean;
    minArrowSize: number;
    maxArrowSize: number;
    labelSizeRatio: number;
    labelRenderer(ctx: CanvasRenderingContext2D, data: NodeDisplayData): void;
}
export function createSettings(options: OptionsRef, hover: HoverState, initial: ViewerOptions): LegacySettings {
    const { isDarkMode, labelThreshold } = initial;
    const { nodeReducer, edgeReducer } = createReducers(options, hover, initial);
    return { allowInvalidContainer: true, // Prevent "Sigma: Container has no width" error
        // WebGL is the default and more robust for standard setups
        nodeReducer,
        edgeReducer,
        renderEdges: true, // Native edge rendering
        defaultEdgeType: "line",
        minEdgeThickness: 0.2,
        minArrowSize: 3,
        maxArrowSize: 6,
        labelColor: { color: isDarkMode ? "#ffffff" : "#000000" },
        labelRenderedSizeThreshold: labelThreshold,
        labelDensity: 0.005,
        labelGridCellSize: 160,
        labelSizeRatio: 1.1,
        labelRenderer: (ctx: CanvasRenderingContext2D, data: NodeDisplayData) => {
            const isDark = options.current.isDarkMode;
            const fontSize = Math.max(data.size / 2, 10);
            const x = data.x + data.size + 3;
            const y = data.y + fontSize / 3;
            if (data.highlighted) {
                const bgColor = isDark ? "#000000" : "#ffffff";
                const textColor = isDark ? "#ffffff" : "#000000";
                ctx.font = `bold ${String(fontSize)}px Arial`;
                const labelText = data.label || "";
                const width = ctx.measureText(labelText).width;
                ctx.fillStyle = bgColor;
                ctx.fillRect(x - 6, y - fontSize - 3, width + 12, fontSize + 9);
                ctx.fillStyle = textColor;
                ctx.fillText(labelText, x, y);
            }
            else {
                ctx.font = `${String(fontSize)}px Arial`;
                ctx.fillStyle = isDark ? "#ffffff" : "#000000";
                const labelText = data.label || "";
                ctx.fillText(labelText, x, y);
            }
        },
        defaultDrawNodeHover: (context, data, settings) => {
            // Sigma only recomputes its internal hover on pointer movement.
            // The application hover is cleared before layout moves nodes,
            // so never draw an internal hover that no longer has an owner.
            if (!hover.node)
                return;
            // Simplified hover draw for reliability
            const size = settings.labelSize;
            const font = settings.labelFont;
            const weight = settings.labelWeight;
            const isDark = options.current.isDarkMode;
            context.font = `${weight} ${String(size)}px ${font}`;
            const labelBgColor = isDark ? "#000000" : "#ffffff";
            const textColor = isDark ? "#ffffff" : "#000000";
            const nodeBorderColor = (typeof data.borderColor === "string" ? data.borderColor : "") || "#ffffff";
            context.fillStyle = nodeBorderColor;
            context.beginPath();
            context.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2, true);
            context.fill();
            if (data.label) {
                const labelText = data.label;
                const width = context.measureText(labelText).width;
                context.fillStyle = labelBgColor;
                context.fillRect(data.x + data.size - 3, data.y - size - 3, width + 12, size + 9);
                context.fillStyle = textColor;
                context.fillText(labelText, data.x + data.size + 3, data.y + size / 3);
            }
        }
    };
}

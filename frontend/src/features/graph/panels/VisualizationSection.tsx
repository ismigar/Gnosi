import { GraphToggleRow } from './GraphToggleRow';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { CollapsibleSection } from '../../../shared/ui/sections/CollapsibleSection';

/**
 * Visualization controls section for the graph.
 * Includes: arrows toggle, label threshold, node size, edge thickness
 */
export interface VisualizationSectionProps {
    readonly edgeThickness: number;
    readonly labelThreshold: number;
    readonly nodeSize: number;
    readonly onEdgeThicknessChange: (value: number) => unknown;
    readonly onLabelThresholdChange: (value: number) => unknown;
    readonly onNodeSizeChange: (value: number) => unknown;
    readonly onShowArrowsChange: (showArrows: boolean) => unknown;
    readonly showArrows: boolean;
}

export function VisualizationSection({
    showArrows,
    onShowArrowsChange,
    labelThreshold,
    onLabelThresholdChange,
    nodeSize,
    onNodeSizeChange,
    edgeThickness,
    onEdgeThicknessChange
}: VisualizationSectionProps) {
    const { t } = useTranslation();
    const sliderStyle: CSSProperties = {
        width: '100%',
        cursor: 'pointer'
    };

    const labelStyle: CSSProperties = {
        fontSize: '0.85rem',
        color: 'var(--text-secondary)',
        display: 'block',
        marginBottom: '4px'
    };

    const valueStyle: CSSProperties = {
        fontSize: '0.75rem',
        color: 'var(--text-tertiary)',
        marginLeft: '8px'
    };

    const sliderContainerStyle: CSSProperties = {
        marginBottom: '12px'
    };

    return (
        <CollapsibleSection title={t('graph.visualization.title', "Visualization")} defaultOpen={false}>
            {/* Arrows toggle */}
            <GraphToggleRow active={showArrows} label={t('graph.visualization.arrows', 'Arrows')} onChange={() => { onShowArrowsChange(!showArrows); }}>
                {t('graph.visualization.arrows', 'Arrows')}
            </GraphToggleRow>

            {/* Label threshold slider */}
            <div style={sliderContainerStyle}>
                <label htmlFor="graph-label-threshold" style={labelStyle}>
                    {t('graph.visualization.label_threshold', "Text fade threshold")}
                    <span style={valueStyle}>{labelThreshold}</span>
                </label>
                <input
                    type="range"
                    id="graph-label-threshold"
                    min="1"
                    max="50"
                    value={labelThreshold}
                    onChange={(e) => {
                        onLabelThresholdChange(Number(e.target.value));
                    }}
                    style={sliderStyle}
                />
            </div>

            {/* Node size slider */}
            <div style={sliderContainerStyle}>
                <label htmlFor="graph-node-size" style={labelStyle}>
                    {t('graph.visualization.node_size', "Node size")}
                    <span style={valueStyle}>{nodeSize.toFixed(1)}x</span>
                </label>
                <input
                    type="range"
                    id="graph-node-size"
                    min="0.1"
                    max="3"
                    step="0.05"
                    value={nodeSize}
                    onChange={(e) => {
                        onNodeSizeChange(Number(e.target.value));
                    }}
                    style={sliderStyle}
                />
            </div>

            {/* Edge thickness slider */}
            <div style={sliderContainerStyle}>
                <label htmlFor="graph-edge-thickness" style={labelStyle}>
                    {t('graph.visualization.edge_thickness', "Edge thickness")}
                    <span style={valueStyle}>{edgeThickness.toFixed(1)}x</span>
                </label>
                <input
                    type="range"
                    id="graph-edge-thickness"
                    min="0.1"
                    max="3"
                    step="0.05"
                    value={edgeThickness}
                    onChange={(e) => {
                        onEdgeThicknessChange(Number(e.target.value));
                    }}
                    style={sliderStyle}
                />
            </div>
        </CollapsibleSection>
    );
}

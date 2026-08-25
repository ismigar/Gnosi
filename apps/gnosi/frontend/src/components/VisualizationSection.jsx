import React from 'react';
import { useTranslation } from 'react-i18next';
import { CollapsibleSection } from './CollapsibleSection';

/**
 * Visualization controls section for the graph.
 * Includes: arrows toggle, label threshold, node size, edge thickness
 */
export function VisualizationSection({
    showArrows,
    onShowArrowsChange,
    labelThreshold,
    onLabelThresholdChange,
    nodeSize,
    onNodeSizeChange,
    edgeThickness,
    onEdgeThicknessChange
}) {
    const { t } = useTranslation();
    const sliderStyle = {
        width: '100%',
        cursor: 'pointer'
    };

    const labelStyle = {
        fontSize: '0.85rem',
        color: 'var(--text-secondary)',
        display: 'block',
        marginBottom: '4px'
    };

    const valueStyle = {
        fontSize: '0.75rem',
        color: 'var(--text-tertiary)',
        marginLeft: '8px'
    };

    const toggleContainerStyle = {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px'
    };

    const toggleStyle = {
        width: '48px',
        height: '24px',
        backgroundColor: showArrows ? '#3498db' : '#ccc',
        borderRadius: '12px',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background-color 0.2s'
    };

    const toggleKnobStyle = {
        width: '20px',
        height: '20px',
        backgroundColor: 'white',
        borderRadius: '50%',
        position: 'absolute',
        top: '2px',
        left: showArrows ? '26px' : '2px',
        transition: 'left 0.2s',
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
    };

    const sliderContainerStyle = {
        marginBottom: '12px'
    };

    return (
        <CollapsibleSection title={t('graph.visualization.title', "Visualization")} defaultOpen={false}>
            {/* Arrows toggle */}
            <div style={toggleContainerStyle}>
                <span style={{ fontSize: '0.9rem' }}>{t('graph.visualization.arrows', "Arrows")}</span>
                <button
                    type="button"
                    style={toggleStyle}
                    onClick={() => onShowArrowsChange(!showArrows)}
                    aria-label={t('graph.visualization.arrows', 'Arrows')}
                    aria-pressed={showArrows}
                >
                    <div style={toggleKnobStyle} />
                </button>
            </div>

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
                    onChange={(e) => onLabelThresholdChange(Number(e.target.value))}
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
                    onChange={(e) => onNodeSizeChange(Number(e.target.value))}
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
                    onChange={(e) => onEdgeThicknessChange(Number(e.target.value))}
                    style={sliderStyle}
                />
            </div>
        </CollapsibleSection>
    );
}

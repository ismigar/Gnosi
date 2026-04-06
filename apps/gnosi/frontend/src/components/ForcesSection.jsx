import React from 'react';
import { CollapsibleSection } from './CollapsibleSection';

/**
 * Physics/Forces controls section for the graph.
 * Includes: gravity, repulsion (scaling), friction (slowDown).
 */
export function ForcesSection({
    gravity,
    onGravityChange,
    repulsion,
    onRepulsionChange,
    friction,
    onFrictionChange,
    edgeInfluence = 0,
    onEdgeInfluenceChange = () => { },
    linLogMode = false,
    onLinLogModeChange = () => { }
}) {
    const sliderStyle = {
        width: '100%',
        cursor: 'pointer'
    };

    const labelStyle = {
        fontSize: '0.85rem',
        color: '#666',
        display: 'block',
        marginBottom: '4px'
    };

    const valueStyle = {
        fontSize: '0.75rem',
        color: '#888',
        marginLeft: '8px'
    };

    const sliderContainerStyle = {
        marginBottom: '12px'
    };

    return (
        <CollapsibleSection title="Forces" defaultOpen={false}>
            {/* LinLog Mode (Cloud Mode) */}
            <div style={{ ...sliderContainerStyle, display: 'flex', alignItems: 'center' }}>
                <input
                    type="checkbox"
                    checked={linLogMode}
                    onChange={(e) => onLinLogModeChange(e.target.checked)}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                />
                <label style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }} onClick={() => onLinLogModeChange(!linLogMode)}>
                    Mode Núvol (LinLog) - <span style={{ fontSize: '0.7rem', color: '#999' }}>Millor per clústers</span>
                </label>
            </div>

            {/* Gravity (Centering Force) */}
            <div style={sliderContainerStyle}>
                <label style={labelStyle}>
                    Força de centrat (Gravetat)
                    <span style={valueStyle}>{gravity}</span>
                </label>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={gravity}
                    onChange={(e) => onGravityChange(Number(e.target.value))}
                    style={sliderStyle}
                />
            </div>

            {/* Repulsion (Scaling Ratio) */}
            <div style={sliderContainerStyle}>
                <label style={labelStyle}>
                    Repulsió (Escalat)
                    <span style={valueStyle}>{repulsion}</span>
                </label>
                <input
                    type="range"
                    min="10"
                    max="50000"
                    step="100"
                    value={repulsion}
                    onChange={(e) => onRepulsionChange(Number(e.target.value))}
                    style={sliderStyle}
                />
            </div>

            {/* Friction (Slow Down) */}
            {/* Note: Higher friction (slowDown) means smoother but slower movement. Lower is more jittery. */}
            <div style={sliderContainerStyle}>
                <label style={labelStyle}>
                    Fricció (Suavitzat)
                    <span style={valueStyle}>{friction}</span>
                </label>
                <input
                    type="range"
                    min="1"
                    max="20"
                    step="1"
                    value={friction}
                    onChange={(e) => onFrictionChange(Number(e.target.value))}
                    style={sliderStyle}
                />
            </div>

            {/* Edge Influence (Weight Impact) */}
            {/* 0 = Treat all edges as weight 1 (Good for structure only) */}
            {/* 1 = Use full edge weight (Good for semantic clustering) */}
            <div style={sliderContainerStyle}>
                <label style={labelStyle}>
                    Força dels Enllaços (Influència)
                    <span style={valueStyle}>{edgeInfluence}</span>
                </label>
                <input
                    type="range"
                    min="0"
                    max="10"
                    step="0.1"
                    value={edgeInfluence}
                    onChange={(e) => onEdgeInfluenceChange(Number(e.target.value))}
                    style={sliderStyle}
                />
            </div>

            <div style={{ fontSize: '0.7rem', color: '#999', marginTop: '8px', fontStyle: 'italic' }}>
                Nota: Canviar aquests valors reiniciarà la simulació física.
            </div>
        </CollapsibleSection>
    );
}

import React from 'react';
import { useTranslation } from 'react-i18next';
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
    onLinLogModeChange = () => { },
    strongGravityMode = false,
    onStrongGravityModeChange = () => { },
    outboundAttractionDistribution = false,
    onOutboundAttractionDistributionChange = () => { }
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

    const sliderContainerStyle = {
        marginBottom: '12px'
    };

    return (
        <CollapsibleSection title={t('graph.forces.title', 'Forces')} defaultOpen={false}>
            {/* LinLog Mode (Cloud Mode) */}
            <div style={{ ...sliderContainerStyle, display: 'flex', alignItems: 'center' }}>
                <input
                    type="checkbox"
                    checked={linLogMode}
                    onChange={(e) => onLinLogModeChange(e.target.checked)}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                />
                <label style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }} onClick={() => onLinLogModeChange(!linLogMode)}>
                    {t('graph.forces.cloud_mode', 'Mode Núvol (LinLog)')} - <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{t('graph.forces.cloud_mode_hint', 'Millor per clústers')}</span>
                </label>
            </div>

            {/* Gravity (Centering Force) */}
            <div style={sliderContainerStyle}>
                <label style={labelStyle}>
                    {t('graph.forces.gravity', 'Força de centrat (Gravetat)')}
                    <span style={valueStyle}>{gravity}</span>
                </label>
                <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.01"
                    value={gravity}
                    onChange={(e) => onGravityChange(Number(e.target.value))}
                    style={sliderStyle}
                />
            </div>

            {/* Repulsion (Scaling Ratio) */}
            <div style={sliderContainerStyle}>
                <label style={labelStyle}>
                    {t('graph.forces.repulsion', 'Repulsió (Escalat)')}
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
                    {t('graph.forces.friction', 'Fricció (Suavitzat)')}
                    <span style={valueStyle}>{friction}</span>
                </label>
                <input
                    type="range"
                    min="1"
                    max="10"
                    step="0.5"
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
                    {t('graph.forces.edge_influence', 'Força dels Enllaços (Influència)')}
                    <span style={valueStyle}>{edgeInfluence}</span>
                </label>
                <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={edgeInfluence}
                    onChange={(e) => onEdgeInfluenceChange(Number(e.target.value))}
                    style={sliderStyle}
                />
            </div>

            {/* Strong Gravity Mode */}
            <div style={{ ...sliderContainerStyle, display: 'flex', alignItems: 'center' }}>
                <input
                    type="checkbox"
                    checked={strongGravityMode}
                    onChange={(e) => onStrongGravityModeChange(e.target.checked)}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                />
                <label style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }} onClick={() => onStrongGravityModeChange(!strongGravityMode)}>
                    {t('graph.forces.strong_gravity', 'Gravetat forta')} - <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{t('graph.forces.strong_gravity_hint', 'Evita que els orfes escapin')}</span>
                </label>
            </div>

            {/* Outbound Attraction Distribution */}
            <div style={{ ...sliderContainerStyle, display: 'flex', alignItems: 'center' }}>
                <input
                    type="checkbox"
                    checked={outboundAttractionDistribution}
                    onChange={(e) => onOutboundAttractionDistributionChange(e.target.checked)}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                />
                <label style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }} onClick={() => onOutboundAttractionDistributionChange(!outboundAttractionDistribution)}>
                    {t('graph.forces.outbound', 'Distribuir atracció per grau')} - <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{t('graph.forces.outbound_hint', 'Comprimeix hubs (off = radial tipus Obsidian)')}</span>
                </label>
            </div>

            <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '8px', fontStyle: 'italic' }}>
                {t('graph.forces.note', 'Nota: Canviar aquests valors reiniciarà la simulació física.')}
            </div>
        </CollapsibleSection>
    );
}

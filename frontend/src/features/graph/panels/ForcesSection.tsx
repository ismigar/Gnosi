import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { CollapsibleSection } from '../../../shared/ui/sections/CollapsibleSection';

/**
 * Physics/Forces controls section for the graph.
 * Includes: gravity, repulsion (scaling), friction (slowDown).
 */
export interface ForcesSectionProps {
    readonly edgeInfluence?: number;
    readonly friction: number;
    readonly gravity: number;
    readonly linLogMode?: boolean;
    readonly onEdgeInfluenceChange?: (value: number) => unknown;
    readonly onFrictionChange: (value: number) => unknown;
    readonly onGravityChange: (value: number) => unknown;
    readonly onLinLogModeChange?: (enabled: boolean) => unknown;
    readonly onOutboundAttractionDistributionChange?: (enabled: boolean) => unknown;
    readonly onRepulsionChange: (value: number) => unknown;
    readonly onStrongGravityModeChange?: (enabled: boolean) => unknown;
    readonly outboundAttractionDistribution?: boolean;
    readonly repulsion: number;
    readonly strongGravityMode?: boolean;
}

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
}: ForcesSectionProps) {
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
        <CollapsibleSection title={t('graph.forces.title', 'Forces')} defaultOpen={false}>
            {/* LinLog Mode (Cloud Mode) */}
            <div style={{ ...sliderContainerStyle, display: 'flex', alignItems: 'center' }}>
                <input
                    type="checkbox"
                    id="graph-force-linlog"
                    checked={linLogMode}
                    onChange={(e) => {
                        onLinLogModeChange(e.target.checked);
                    }}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                />
                <label htmlFor="graph-force-linlog" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>
                    {t('graph.forces.cloud_mode', "Cloud Mode (LinLog)")} - <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{t('graph.forces.cloud_mode_hint', "Better for clusters")}</span>
                </label>
            </div>

            {/* Gravity (Centering Force) */}
            <div style={sliderContainerStyle}>
                <label htmlFor="graph-force-gravity" style={labelStyle}>
                    {t('graph.forces.gravity', "Centering force (Gravity)")}
                    <span style={valueStyle}>{gravity}</span>
                </label>
                <input
                    type="range"
                    id="graph-force-gravity"
                    min="0"
                    max="2"
                    step="0.01"
                    value={gravity}
                    onChange={(e) => {
                        onGravityChange(Number(e.target.value));
                    }}
                    style={sliderStyle}
                />
            </div>

            {/* Repulsion (Scaling Ratio) */}
            <div style={sliderContainerStyle}>
                <label htmlFor="graph-force-repulsion" style={labelStyle}>
                    {t('graph.forces.repulsion', "Repulsion (Scaling)")}
                    <span style={valueStyle}>{repulsion}</span>
                </label>
                <input
                    type="range"
                    id="graph-force-repulsion"
                    min="10"
                    max="50000"
                    step="10"
                    value={repulsion}
                    onChange={(e) => {
                        onRepulsionChange(Number(e.target.value));
                    }}
                    style={sliderStyle}
                />
            </div>

            {/* Friction (Slow Down) */}
            {/* Note: Higher friction (slowDown) means smoother but slower movement. Lower is more jittery. */}
            <div style={sliderContainerStyle}>
                <label htmlFor="graph-force-friction" style={labelStyle}>
                    {t('graph.forces.friction', "Friction (Smoothing)")}
                    <span style={valueStyle}>{friction}</span>
                </label>
                <input
                    type="range"
                    id="graph-force-friction"
                    min="1"
                    max="10"
                    step="0.5"
                    value={friction}
                    onChange={(e) => {
                        onFrictionChange(Number(e.target.value));
                    }}
                    style={sliderStyle}
                />
            </div>

            {/* Edge Influence (Weight Impact) */}
            {/* 0 = Treat all edges as weight 1 (Good for structure only) */}
            {/* 1 = Use full edge weight (Good for semantic clustering) */}
            <div style={sliderContainerStyle}>
                <label htmlFor="graph-force-edge-influence" style={labelStyle}>
                    {t('graph.forces.edge_influence', "Edge force (Influence)")}
                    <span style={valueStyle}>{edgeInfluence}</span>
                </label>
                <input
                    type="range"
                    id="graph-force-edge-influence"
                    min="0"
                    max="2"
                    step="0.1"
                    value={edgeInfluence}
                    onChange={(e) => {
                        onEdgeInfluenceChange(Number(e.target.value));
                    }}
                    style={sliderStyle}
                />
            </div>

            {/* Strong Gravity Mode */}
            <div style={{ ...sliderContainerStyle, display: 'flex', alignItems: 'center' }}>
                <input
                    type="checkbox"
                    id="graph-force-strong-gravity"
                    checked={strongGravityMode}
                    onChange={(e) => {
                        onStrongGravityModeChange(e.target.checked);
                    }}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                />
                <label htmlFor="graph-force-strong-gravity" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>
                    {t('graph.forces.strong_gravity', "Strong gravity")} - <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{t('graph.forces.strong_gravity_hint', "Prevents orphans from escaping")}</span>
                </label>
            </div>

            {/* Outbound Attraction Distribution */}
            <div style={{ ...sliderContainerStyle, display: 'flex', alignItems: 'center' }}>
                <input
                    type="checkbox"
                    id="graph-force-outbound"
                    checked={outboundAttractionDistribution}
                    onChange={(e) => {
                        onOutboundAttractionDistributionChange(e.target.checked);
                    }}
                    style={{ marginRight: '8px', cursor: 'pointer' }}
                />
                <label htmlFor="graph-force-outbound" style={{ ...labelStyle, marginBottom: 0, cursor: 'pointer' }}>
                    {t('graph.forces.outbound', "Distribute attraction by degree")} - <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{t('graph.forces.outbound_hint', "Compresses hubs (off = Obsidian-style radial)")}</span>
                </label>
            </div>

            <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '8px', fontStyle: 'italic' }}>
                {t('graph.forces.note', "Note: Changing these values will restart the physics simulation.")}
            </div>
        </CollapsibleSection>
    );
}

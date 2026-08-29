import { useTranslation } from 'react-i18next';
import {
    CONNECTION_TYPE_COLORS,
    type ConnectionType,
} from '../utils/graphLegend';

interface LegendCluster {
    readonly color: string;
    readonly count: number;
    readonly label: string;
}

interface GraphLegendData {
    readonly legend?: {
        readonly clusters?: readonly LegendCluster[];
    };
}

export interface LegendProps {
    readonly colorMode: string;
    readonly connectionTypeCounts?: Partial<Record<ConnectionType, number>> | null;
    readonly filteredEdgesCount?: number;
    readonly filteredNodesCount?: number;
    readonly graphData?: GraphLegendData | null;
}

const CONNECTION_TYPES = [
    'wikilink',
    'database_wikilink',
    'unresolved',
    'semantic_similarity',
] as const satisfies readonly ConnectionType[];

export const Legend = ({
    graphData,
    colorMode,
    filteredNodesCount,
    filteredEdgesCount,
    connectionTypeCounts,
}: LegendProps) => {

    const { t } = useTranslation();
    if (!graphData) return null;

    const { clusters = [] } = graphData.legend || {};

    // Select the active node grouping for the current color mode.
    let nodeItems: readonly LegendCluster[] = [];
    let nodeGroupsLabel = t('graph.legend.node_groups', 'Node groups');
    if (colorMode === 'kind') {
        // Content types are intentionally omitted from the legend.
        nodeItems = [];
    }
    else if (colorMode === 'cluster') {
        nodeItems = clusters;
        nodeGroupsLabel = t('graph.legend.clusters', 'Clusters');
    }

    // Omit empty groups from the tooltip.
    const visibleNodeItems = nodeItems.filter(item => item.count > 0);

    return (
        <div className="graph-legend-content">
            <div className="graph-legend-summary">
                <strong>{t('graph.legend.nodes', 'Nodes')}: {filteredNodesCount || 0}</strong>
                <span>{t('graph.legend.connections', 'Connections')}: {filteredEdgesCount || 0}</span>
            </div>
            <section className="graph-legend-section" aria-label={t('graph.legend.connection_types', 'Connection types')}>
                <strong>{t('graph.legend.connection_types', 'Connection types')}</strong>
                {CONNECTION_TYPES.map((type) => [type, connectionTypeCounts?.[type] ?? 0] as const)
                    .filter(([, count]) => count > 0)
                    .map(([type, count]) => (
                    <div className="graph-legend-item" key={type}>
                        <span className="graph-legend-line" style={{ background: CONNECTION_TYPE_COLORS[type] }} />
                        <span>{t(`graph.legend.${type}`, type)} ({count})</span>
                    </div>
                    ))}
            </section>
            {visibleNodeItems.length > 0 && (
                <section className="graph-legend-section" aria-label={nodeGroupsLabel}>
                    <strong>{nodeGroupsLabel}</strong>
                    {visibleNodeItems.map((item) => (
                        <div className="graph-legend-item" key={item.label}>
                            <span className="graph-legend-dot" style={{ background: item.color }} />
                            <span>{item.label} ({item.count})</span>
                        </div>
                    ))}
                </section>
            )}
        </div>
    );
};

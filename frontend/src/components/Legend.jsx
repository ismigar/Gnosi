import { useTranslation } from 'react-i18next';

const connectionTypeColors = {
    wikilink: '#10b981',
    database_wikilink: '#6366f1',
    unresolved: '#cbd5e1',
    semantic_similarity: '#a855f7',
};

export const Legend = ({ graphData, colorMode, filteredNodesCount, filteredEdgesCount, connectionTypeCounts }) => {

    const { t } = useTranslation();
    if (!graphData) return null;

    const { clusters = [], ai_clusters = [] } = graphData.legend || {};

    // Select the active node grouping for the current color mode.
    let nodeItems = [];
    let nodeGroupsLabel = t('graph.legend.node_groups', 'Node groups');
    if (colorMode === 'kind') {
        // Content types are intentionally omitted from the legend.
        nodeItems = [];
    }
    else if (colorMode === 'cluster') {
        nodeItems = clusters;
        nodeGroupsLabel = t('graph.legend.clusters', 'Clusters');
    } else if (colorMode === 'ai_cluster') {
        nodeItems = ai_clusters;
        nodeGroupsLabel = t('graph.legend.ai_clusters', 'AI clusters');
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
                {Object.entries(connectionTypeCounts || {}).filter(([, count]) => count > 0).map(([type, count]) => (
                    <div className="graph-legend-item" key={type}>
                        <span className="graph-legend-line" style={{ background: connectionTypeColors[type] }} />
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

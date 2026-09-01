import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
    getVisibleConnectionGroups,
    type ConnectionFilters,
    type ConnectionGraph,
} from '../model/graphConnections';
import { CONNECTION_TYPE_COLORS } from '../model/graphLegend';
import { hasSemanticSuggestions, type SemanticEdge } from '../../../shared/graph/model/semanticOverlay';

interface ConnectionGraphData {
    readonly edges?: readonly SemanticEdge[] | null;
}

export interface ConnectionListProps {
    readonly filters?: ConnectionFilters;
    readonly graphData?: ConnectionGraphData | null;
    readonly graphInstance?: ConnectionGraph | null;
}

export const ConnectionList = ({
    graphInstance,
    graphData,
    filters = {},
}: ConnectionListProps) => {
    const { t } = useTranslation();
    const groupedConnections = useMemo(
        () => getVisibleConnectionGroups(graphInstance, filters, graphData?.edges ?? []),
        [graphInstance, graphData?.edges, filters],
    );
    const hasSemanticData = hasSemanticSuggestions(graphData?.edges);

    return (
        <section
            aria-labelledby="visible-connections-title"
            style={{
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                borderTop: '1px solid var(--border-primary)',
                borderRadius: '8px',
                padding: '20px',
            }}
        >
            <h3 id="visible-connections-title" style={{ marginTop: 0, marginBottom: '6px', fontSize: '1.1rem' }}>
                {t('graph.connections_panel.title', 'Visible connections')}
            </h3>
            <p style={{ margin: '0 0 4px', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                {t(
                    'graph.connections_panel.description',
                    'Each group is a visible source note and each row is one outgoing connection. Types and colors match the legend.',
                )}
            </p>
            {Boolean(filters.showSemanticSuggestions) && hasSemanticData && (
                <p style={{ margin: '0 0 14px', color: 'var(--text-secondary)', fontSize: '0.82rem' }}>
                    {t(
                        'graph.connections_panel.semantic_note',
                        'Semantic connections are pending Brain proposals; they do not modify notes.',
                    )}
                </p>
            )}

            {groupedConnections.length === 0 ? (
                <p style={{ margin: '14px 0 0', color: 'var(--text-tertiary)', fontSize: '0.9rem' }}>
                    {t('graph.connections_panel.empty', 'There are no visible connections with the current filters.')}
                </p>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {groupedConnections.map((group) => (
                        <div key={group.id} style={{
                            background: 'var(--bg-secondary)',
                            borderRadius: '8px',
                            padding: '12px',
                        }}>
                            <div style={{ marginBottom: '8px', fontWeight: 'bold', fontSize: '1rem', borderBottom: '1px solid var(--border-primary)', paddingBottom: '4px' }}>
                                {group.url ? (
                                    <a href={group.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px dotted currentColor' }}>
                                        {group.label}
                                    </a>
                                ) : group.label}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '8px' }}>
                                {group.targets.map((connection) => (
                                    <div key={connection.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem' }}>
                                        <span aria-hidden="true" style={{ color: 'var(--text-tertiary)' }}>
                                            {connection.directed ? '→' : '↔'}
                                        </span>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{ fontWeight: 500 }}>
                                                {connection.url ? (
                                                    <a href={connection.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px dotted currentColor' }}>
                                                        {connection.label}
                                                    </a>
                                                ) : connection.label}
                                            </div>
                                            {connection.reason && (
                                                <div title={connection.reason} style={{ marginTop: '2px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                                                    {connection.reason.length > 140
                                                        ? `${connection.reason.slice(0, 140)}…`
                                                        : connection.reason}
                                                </div>
                                            )}
                                        </div>
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.76rem', whiteSpace: 'nowrap' }}>
                                            <span aria-hidden="true" style={{ width: '18px', height: '3px', borderRadius: '2px', background: CONNECTION_TYPE_COLORS[connection.type] }} />
                                            {t(`graph.legend.${connection.type}`, connection.type)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
};

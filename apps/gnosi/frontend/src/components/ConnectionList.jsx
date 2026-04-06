import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { applyFilters } from '../utils/graphFilters';

export const ConnectionList = ({ graphInstance, filters, isDarkMode }) => {
    const { t } = useTranslation();
    const groupedConnections = useMemo(() => {
        if (!graphInstance) return [];

        // Apply filters to get visible edges
        const { visibleEdges } = applyFilters(graphInstance, filters);

        const groups = {};

        visibleEdges.forEach(edge => {
            const attrs = graphInstance.getEdgeAttributes(edge);
            const source = graphInstance.source(edge);
            const target = graphInstance.target(edge);

            const sourceAttrs = graphInstance.getNodeAttributes(source);
            const targetAttrs = graphInstance.getNodeAttributes(target);

            if (!groups[source]) {
                groups[source] = {
                    id: source,
                    label: sourceAttrs.label || source,
                    url: sourceAttrs.url,
                    targets: []
                };
            }

            groups[source].targets.push({
                id: edge,
                label: targetAttrs.label || target,
                url: targetAttrs.url,
                similarity: attrs.similarity, // Don't default to 0 yet
                reasons: attrs.reasons || attrs.reason || attrs.evidence || [],
                color: attrs.color,
                isTagEdge: attrs.isTagEdge
            });
        });

        // Sort targets by similarity within each group
        Object.values(groups).forEach(group => {
            group.targets.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        });

        // Sort groups by label
        return Object.values(groups).sort((a, b) => a.label.localeCompare(b.label));
    }, [graphInstance, filters]);

    if (!graphInstance || groupedConnections.length === 0) return null;

    return (
        <div style={{
            background: isDarkMode ? '#1e1e1e' : '#fff',
            color: isDarkMode ? '#eee' : '#333',
            borderTop: `1px solid ${isDarkMode ? '#333' : '#eee'}`,
            borderRadius: '8px',
            padding: '20px'
        }}>
            <h3 style={{ marginTop: 0, fontSize: '1.1rem' }}>{t('connections_title')}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {groupedConnections.map(group => (
                    <div key={group.id} style={{
                        background: isDarkMode ? '#252525' : '#f0f0f0',
                        borderRadius: '8px',
                        padding: '12px'
                    }}>
                        <div style={{ marginBottom: '8px', fontWeight: 'bold', fontSize: '1rem', borderBottom: `1px solid ${isDarkMode ? '#444' : '#ddd'}`, paddingBottom: '4px' }}>
                            {group.url ? (
                                <a href={group.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px dotted currentColor' }}>
                                    {group.label}
                                </a>
                            ) : (
                                group.label
                            )}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '8px' }}>
                            {group.targets.map(conn => (
                                <div key={conn.id} style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    fontSize: '0.9rem'
                                }}>
                                    <span style={{ marginRight: '8px', color: '#888' }}>↳</span>
                                    <span style={{ fontWeight: 500 }}>
                                        {conn.url ? (
                                            <a href={conn.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none', borderBottom: '1px dotted currentColor' }}>
                                                {conn.label}
                                            </a>
                                        ) : (
                                            conn.label
                                        )}
                                    </span>

                                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                        <span style={{
                                            fontSize: '0.8rem',
                                            color: isDarkMode ? '#aaa' : '#666',
                                            fontStyle: 'italic'
                                        }}>
                                            {(() => {
                                                const text = Array.isArray(conn.reasons) ? conn.reasons.join(', ') : conn.reasons;
                                                return text.length > 100 ? text.substring(0, 100) + '...' : text;
                                            })()}
                                        </span>
                                        {!conn.isTagEdge && conn.similarity !== undefined && (
                                            <span style={{
                                                background: conn.color || '#888',
                                                color: '#fff',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                fontSize: '0.75rem',
                                                minWidth: '30px',
                                                textAlign: 'center'
                                            }}>
                                                {Math.round(conn.similarity)}%
                                            </span>
                                        )}
                                        {conn.isTagEdge && (
                                            <span style={{
                                                background: '#ddd',
                                                color: '#555',
                                                padding: '2px 6px',
                                                borderRadius: '4px',
                                                fontSize: '0.75rem'
                                            }}>
                                                Tag
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

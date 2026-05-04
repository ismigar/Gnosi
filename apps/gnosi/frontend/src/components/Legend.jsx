import React from 'react';
import { useTranslation } from 'react-i18next';

export const Legend = ({ graphData, isDarkMode, colorMode, filteredNodesCount, filteredEdgesCount }) => {

    const { t } = useTranslation();
    if (!graphData || !graphData.legend) return null;

    const { edges = [], kinds = [], clusters = [], ai_clusters = [] } = graphData.legend;

    const legendOffset = 85;

    // Determine which node items to show based on colorMode
    let nodeItems = [];
    if (colorMode === 'kind') {
        // User requested to remove content types from legend
        nodeItems = [];
    }
    else if (colorMode === 'cluster') nodeItems = clusters;
    else if (colorMode === 'ai_cluster') nodeItems = ai_clusters;

    // Filter out items with 0 count
    const visibleNodeItems = nodeItems.filter(item => item.count > 0);

    return (
        <div
            style={{
                position: 'absolute',
                bottom: '20px',
                left: `calc(50% + ${legendOffset}px)`,
                transform: 'translateX(-50%)',
                background: isDarkMode ? 'rgba(30, 30, 30, 0.95)' : 'rgba(255, 255, 255, 0.95)',
                color: isDarkMode ? '#fff' : '#000',
                padding: '12px 20px',
                borderRadius: '8px',
                border: `1px solid ${isDarkMode ? '#444' : '#ddd'}`,
                fontSize: '11px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                zIndex: 100,
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '20px',
                maxWidth: '90vw',
                overflowX: 'auto',
                whiteSpace: 'nowrap'
            }}
        >
            {/* Counts */}
            <div style={{ display: 'flex', flexDirection: 'column', marginRight: '20px', borderRight: `1px solid ${isDarkMode ? '#444' : '#ddd'}`, paddingRight: '20px' }}>
                <span style={{ fontWeight: 'bold' }}>{filteredNodesCount || 0} Nodes</span>
                <span style={{ opacity: 0.7 }}>{filteredEdgesCount || 0} Edges</span>
            </div>


            {/* Node Legend */}
            {visibleNodeItems.length > 0 && (
                <>
                    <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '15px', alignItems: 'center' }}>
                        {visibleNodeItems.map((item, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div
                                    style={{
                                        width: '12px',
                                        height: '12px',
                                        borderRadius: '50%',
                                        background: item.color,
                                        border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`
                                    }}
                                />
                                <span>{item.label} ({item.count})</span>
                            </div>
                        ))}
                    </div>
                    {/* Vertical Separator */}
                    {edges.length > 0 && (
                        <div style={{ width: '1px', height: '20px', background: isDarkMode ? '#444' : '#ddd' }} />
                    )}
                </>
            )}

            {/* Edge Legend */}
            <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '15px', alignItems: 'center' }}>
                {edges.filter(e => e.label !== "Directed Connection").map((edge, idx) => {
                    let labelKey = edge.label;
                    if (edge.label === "Real Connection") labelKey = "legend_real_connection";
                    else if (edge.label === "Directed Connection") labelKey = "legend_directed_connection";
                    else if (edge.label === "Strong Similarity (>85%)") labelKey = "legend_strong_similarity";
                    else if (edge.label === "Medium Similarity (>70%)") labelKey = "legend_medium_similarity";
                    else if (edge.label === "Weak Similarity (>60%)") labelKey = "legend_weak_similarity";

                    return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div
                                style={{
                                    width: '20px',
                                    height: '2px',
                                    background: edge.color
                                }}
                            />
                            <span style={{ whiteSpace: 'nowrap' }}>{t(labelKey, edge.label)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

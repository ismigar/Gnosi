import React from 'react';
import { useTranslation } from 'react-i18next';

export function Sidebar({
    searchTerm,
    onSearchChange,
    similarity,
    onSimilarityChange,
    hideIsolated,
    onHideIsolatedChange,
    onlyIsolated,
    onOnlyIsolatedChange,
    onSearchSubmit,
    // Timeline props
    minDate,
    maxDate,
    timelineDate,
    onTimelineChange,
    // Color props
    colorMode,
    onColorModeChange,
    hasClusterData = false,
    // Pathfinding props
    isPathfindingMode,
    onPathfindingModeChange,
    pathSource,
    pathTarget,
    pathResult,
    onClearPath,
    getNodeLabel,
    children,
    afterWidgets
}) {
    const { t } = useTranslation();
    const toggleColorMode = (mode) => {
        onColorModeChange(colorMode === mode ? 'kind' : mode);
    };
    return (
        <>
            <div className="section">

                <input
                    type="search"
                    id="search-input"
                    placeholder={t('search_placeholder')}
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            // Trigger search/submit if prop provided
                            if (onSearchSubmit) onSearchSubmit(searchTerm);
                        }
                    }}
                />
            </div>

            {children}

            {/* --- COLOR SELECTOR --- */}
            {hasClusterData && <div className="section">
                <h2 className="filter-title">{t('graph.sidebar.color_by', "Color by")}</h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                    {hasClusterData && <label style={{ cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={colorMode === 'cluster'}
                            onChange={() => toggleColorMode('cluster')}
                            style={{ marginRight: '5px' }}
                        />
                        {t('graph.sidebar.color_cluster', "Cluster")}
                    </label>}
                </div>
            </div>}

            {/* --- PATHFINDING SECTION --- */}
            <div className="section" style={{ border: isPathfindingMode ? '2px solid var(--gnosi-blue)' : 'none', borderRadius: '8px', padding: isPathfindingMode ? '10px' : '0' }}>
                <h2 className="filter-title" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {t('graph.sidebar.pathfinding_title', "Path search")}
                </h2>
                <div style={{ marginBottom: '10px' }}>
                    <button
                        onClick={() => onPathfindingModeChange(!isPathfindingMode)}
                        style={{
                            width: '100%',
                            padding: '8px',
                            backgroundColor: isPathfindingMode ? 'var(--status-error)' : 'var(--gnosi-blue)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        {isPathfindingMode ? t('graph.sidebar.pathfinding_stop', "Stop search") : t('graph.sidebar.pathfinding_start', "Start search")}
                    </button>
                </div>

                {isPathfindingMode && (
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-tertiary)' }}>
                        <div
                            style={{
                                marginBottom: '8px',
                                padding: '8px',
                                borderRadius: '4px',
                                border: !pathSource ? '2px solid var(--status-warning)' : '1px solid var(--border-primary)',
                                backgroundColor: !pathSource ? 'rgba(245, 158, 11, 0.12)' : 'transparent',
                                cursor: 'default'
                            }}
                        >
                            <div style={{ fontWeight: 'bold', color: !pathSource ? 'var(--status-warning)' : 'inherit' }}>
                                {!pathSource ? t('graph.sidebar.pathfinding_select_prompt', "👉 SELECT:") : '✅'} {t('graph.sidebar.pathfinding_origin_label', "Source")}
                            </div>
                            <div style={{ fontSize: '0.85em' }}>
                                {pathSource ? getNodeLabel(pathSource) : t('graph.sidebar.pathfinding_click_node_hint', "(Click a node in the graph)")}
                            </div>
                        </div>

                        <div
                            style={{
                                marginBottom: '10px',
                                padding: '8px',
                                borderRadius: '4px',
                                border: (pathSource && !pathTarget) ? '2px solid var(--status-success)' : '1px solid var(--border-primary)',
                                backgroundColor: (pathSource && !pathTarget) ? 'rgba(16, 185, 129, 0.12)' : 'transparent',
                                cursor: 'default'
                            }}
                        >
                            <div style={{ fontWeight: 'bold', color: (pathSource && !pathTarget) ? 'var(--status-success)' : 'inherit' }}>
                                {(pathSource && !pathTarget) ? t('graph.sidebar.pathfinding_select_prompt', "👉 SELECT:") : (pathTarget ? '✅' : '⏳')} {t('graph.sidebar.pathfinding_target_label', "Target")}
                            </div>
                            <div style={{ fontSize: '0.85em' }}>
                                {pathTarget ? getNodeLabel(pathTarget) : (pathSource ? t('graph.sidebar.pathfinding_click_another_node_hint', "(Click another node)") : t('graph.sidebar.pathfinding_wait_origin_hint', "(Waiting for source selection)"))}
                            </div>
                        </div>

                        {pathSource && (
                            <button
                                onClick={onClearPath}
                                style={{
                                    width: '100%',
                                    padding: '5px',
                                    background: 'none',
                                    border: '1px solid var(--border-primary)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    marginBottom: '10px'
                                }}
                            >
                                {t('graph.sidebar.pathfinding_clear_selection', "Clear selection")}
                            </button>
                        )}

                        {pathResult && pathResult.fullPath && pathResult.fullPath.length > 0 && (
                            <div style={{ marginTop: '10px', padding: '10px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '4px' }}>
                                <div style={{ fontWeight: 'bold', color: 'var(--gnosi-blue)', marginBottom: '5px' }}>{t('graph.sidebar.pathfinding_path_found', { count: pathResult.fullPath.length, defaultValue: "Path found ({{count}} nodes):" })}</div>
                                <div style={{ fontSize: '0.8rem' }}>
                                    {pathResult.fullPath.map((nodeId, index) => (
                                        <div key={nodeId} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                            <span style={{ color: 'var(--gnosi-blue)' }}>{index + 1}.</span>
                                            <span>{getNodeLabel(nodeId)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {pathResult && pathResult.noPath && (
                            <div style={{ marginTop: '10px', padding: '10px', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderRadius: '4px', color: 'var(--status-error)', fontSize: '0.8rem' }}>
                                {t('graph.sidebar.pathfinding_no_path_found', "No path found between these nodes.")}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* --- TIMELINE SECTION --- */}
            <div className="section">
                <h2 className="filter-title">{t('graph.sidebar.timeline_title', "Timeline")}</h2>
                <div className="similarity-filter">
                    {/* Only show slider if we have valid dates */}
                    {minDate && maxDate ? (
                        <>
                            <input
                                type="range"
                                id="timeline-slider"
                                min={minDate}
                                max={maxDate}
                                value={timelineDate || maxDate}
                                step={24 * 60 * 60 * 1000} // Daily steps
                                onChange={(e) => onTimelineChange(Number(e.target.value))}
                                style={{ width: "100%" }}
                            />
                            <label htmlFor="timeline-slider" style={{ fontSize: "0.8rem", marginTop: "5px", display: "block" }}>
                                {new Date(timelineDate || maxDate).toLocaleDateString()}
                            </label>
                        </>
                    ) : (
                        <div style={{ fontSize: "0.8rem", color: "var(--text-tertiary)" }}>{t('graph.sidebar.timeline_no_data', "No time data available")}</div>
                    )}
                </div>
            </div>

            <div className="section">
                <h2 className="filter-title">{t('similarity_score')}</h2>
                <div className="similarity-filter">
                    <input
                        type="range"
                        id="similarity-slider"
                        min="0"
                        max="100"
                        value={similarity}
                        step="1"
                        onChange={(e) => onSimilarityChange(parseInt(e.target.value))}
                    />
                    <label htmlFor="similarity-slider" id="similarity-label">{t('similarity_score')}: {similarity}%</label>
                </div>
            </div>

            <div className="section">
                <div className="filter-item">
                    <input
                        type="checkbox"
                        id="isolated-nodes-filter"
                        checked={hideIsolated}
                        onChange={(e) => onHideIsolatedChange(e.target.checked)}
                    />
                    <label htmlFor="isolated-nodes-filter">{t('graph.sidebar.hide_isolated_nodes', "Hide isolated nodes")}</label>
                </div>

                <div className="filter-item">
                    <input
                        type="checkbox"
                        id="only-isolated-filter"
                        checked={onlyIsolated}
                        onChange={(e) => onOnlyIsolatedChange(e.target.checked)}
                    />
                    <label htmlFor="only-isolated-filter">{t('graph.sidebar.show_only_isolated_nodes', "Show only isolated nodes")}</label>
                </div>
            </div>
            {afterWidgets}
        </>
    );
}

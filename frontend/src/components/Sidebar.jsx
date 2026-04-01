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
    // Pathfinding props
    isPathfindingMode,
    onPathfindingModeChange,
    pathSource,
    pathTarget,
    onClearPath,
    getNodeLabel,
    children,
    afterWidgets
}) {
    const { t } = useTranslation();
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
            <div className="section">
                <h2 className="filter-title">Pintar per</h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <label style={{ cursor: 'pointer' }}>
                        <input
                            type="radio"
                            name="colorMode"
                            value="kind"
                            checked={colorMode === 'kind'}
                            onChange={(e) => onColorModeChange(e.target.value)}
                            style={{ marginRight: '5px' }}
                        />
                        Tipus
                    </label>
                    <label style={{ cursor: 'pointer' }}>
                        <input
                            type="radio"
                            name="colorMode"
                            value="cluster"
                            checked={colorMode === 'cluster'}
                            onChange={(e) => onColorModeChange(e.target.value)}
                            style={{ marginRight: '5px' }}
                        />
                        Clúster
                    </label>
                    <label style={{ cursor: 'pointer' }}>
                        <input
                            type="radio"
                            name="colorMode"
                            value="ai_cluster"
                            checked={colorMode === 'ai_cluster'}
                            onChange={(e) => onColorModeChange(e.target.value)}
                            style={{ marginRight: '5px' }}
                        />
                        IA Cluster
                    </label>
                </div>
            </div>

            {/* --- PATHFINDING SECTION --- */}
            <div className="section" style={{ border: isPathfindingMode ? '2px solid #3498db' : 'none', borderRadius: '8px', padding: isPathfindingMode ? '10px' : '0' }}>
                <h2 className="filter-title" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    Cerca de camins
                </h2>
                <div style={{ marginBottom: '10px' }}>
                    <button
                        onClick={() => onPathfindingModeChange(!isPathfindingMode)}
                        style={{
                            width: '100%',
                            padding: '8px',
                            backgroundColor: isPathfindingMode ? '#e74c3c' : '#3498db',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                    >
                        {isPathfindingMode ? 'Atura la cerca' : 'Comença la cerca'}
                    </button>
                </div>

                {isPathfindingMode && (
                    <div style={{ fontSize: '0.9rem', color: '#888' }}>
                        <div
                            style={{
                                marginBottom: '8px',
                                padding: '8px',
                                borderRadius: '4px',
                                border: !pathSource ? '2px solid #e67e22' : '1px solid #ddd',
                                backgroundColor: !pathSource ? '#fff3e0' : 'transparent',
                                cursor: 'default'
                            }}
                        >
                            <div style={{ fontWeight: 'bold', color: !pathSource ? '#d35400' : 'inherit' }}>
                                {!pathSource ? '👉 SELECCIONA:' : '✅'} Origen
                            </div>
                            <div style={{ fontSize: '0.85em' }}>
                                {pathSource ? getNodeLabel(pathSource) : '(Clica un node al graf)'}
                            </div>
                        </div>

                        <div
                            style={{
                                marginBottom: '10px',
                                padding: '8px',
                                borderRadius: '4px',
                                border: (pathSource && !pathTarget) ? '2px solid #27ae60' : '1px solid #ddd',
                                backgroundColor: (pathSource && !pathTarget) ? '#e8f8f5' : 'transparent',
                                cursor: 'default'
                            }}
                        >
                            <div style={{ fontWeight: 'bold', color: (pathSource && !pathTarget) ? '#27ae60' : 'inherit' }}>
                                {(pathSource && !pathTarget) ? '👉 SELECCIONA:' : (pathTarget ? '✅' : '⏳')} Destí
                            </div>
                            <div style={{ fontSize: '0.85em' }}>
                                {pathTarget ? getNodeLabel(pathTarget) : (pathSource ? '(Clica un altre node)' : '(Espera a seleccionar origen)')}
                            </div>
                        </div>

                        {pathSource && (
                            <button
                                onClick={onClearPath}
                                style={{
                                    width: '100%',
                                    padding: '5px',
                                    background: 'none',
                                    border: '1px solid #ccc',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem',
                                    marginBottom: '10px'
                                }}
                            >
                                Neteja selecció
                            </button>
                        )}

                        {pathResult && pathResult.fullPath && pathResult.fullPath.length > 0 && (
                            <div style={{ marginTop: '10px', padding: '10px', backgroundColor: 'rgba(52, 152, 219, 0.1)', borderRadius: '4px' }}>
                                <div style={{ fontWeight: 'bold', color: '#3498db', marginBottom: '5px' }}>Camí trobat ({pathResult.fullPath.length} nodes):</div>
                                <div style={{ fontSize: '0.8rem' }}>
                                    {pathResult.fullPath.map((nodeId, index) => (
                                        <div key={nodeId} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                            <span style={{ color: '#3498db' }}>{index + 1}.</span>
                                            <span>{getNodeLabel(nodeId)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {pathResult && pathResult.noPath && (
                            <div style={{ marginTop: '10px', padding: '10px', backgroundColor: 'rgba(231, 76, 60, 0.1)', borderRadius: '4px', color: '#e74c3c', fontSize: '0.8rem' }}>
                                No s'ha trobat cap camí entre aquests nodes.
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* --- TIMELINE SECTION --- */}
            <div className="section">
                <h2 className="filter-title">Cronologia</h2>
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
                        <div style={{ fontSize: "0.8rem", color: "#888" }}>No hi ha dades de temps</div>
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
                    <label htmlFor="isolated-nodes-filter">Oculta nodes aïllats</label>
                </div>

                {!hideIsolated && (
                    <div className="filter-item">
                        <input
                            type="checkbox"
                            id="only-isolated-filter"
                            checked={onlyIsolated}
                            onChange={(e) => onOnlyIsolatedChange(e.target.checked)}
                        />
                        <label htmlFor="only-isolated-filter">Mostra només nodes aïllats</label>
                    </div>
                )}
            </div>
            {afterWidgets}
        </>
    );
}

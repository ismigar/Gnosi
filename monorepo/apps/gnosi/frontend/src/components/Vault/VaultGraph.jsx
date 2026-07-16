import React, { useEffect, useState, useRef, useMemo } from 'react';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { GraphViewer } from '../GraphViewer';
import { Loader2, Settings2, Maximize2, ZoomIn, ZoomOut, Target, AlertTriangle } from 'lucide-react';
import { matchesFilters, matchesSearch } from '../../utils/vaultFilters';
import { useConfigChanged } from '../../lib/configEvents';

/**
 * VaultGraph.jsx
 * Graph visualization embedded in the Vault Dashboard.
 * Respects the active Vault view's filters.
 */
export function VaultGraph({ 
    tableId, 
    view = {}, 
    searchTerm = '', 
    isDarkMode = false,
    onNodeClick
}) {
    const { t } = useTranslation();
    const [graphData, setGraphData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState(null);
    const viewerRef = useRef(null);

    // Load graph data and configuration. Defined outside the effect so the
    // partial-graph warning's retry button can re-trigger a full fetch.
    const fetchData = async () => {
        try {
            setLoading(true);
            const [graphRes, configRes] = await Promise.all([
                axios.get('/api/graph'),
                axios.get('/api/config')
            ]);
            setGraphData(graphRes.data);
            setConfig(configRes.data);
        } catch (err) {
            console.error("Error loading graph data:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    // Re-fetch only the config when the Settings modals emit the event
    // (the graph itself doesn't change due to config changes).
    useConfigChanged(async () => {
        try {
            const res = await axios.get('/api/config');
            setConfig(res.data);
        } catch (err) {
            console.error('Error refetching config:', err);
        }
    });

    // Prepare filters based on the Vault's active view
    const filters = useMemo(() => {
        const vaultFilters = view.filters || [];
        
        return {
            // We pass the vault's filters directly
            vaultFilters,
            searchTerm,
            // We mark that we're in "Vault View" mode for the logic in graphFilters.js
            isVaultMode: true,
            activeTableId: tableId
        };
    }, [view.filters, searchTerm, tableId]);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900/50">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    <span className="text-sm text-gray-500">{t('graph.vault_embed.building', 'Construint graf...')}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 relative overflow-hidden bg-white dark:bg-gray-950">
            <GraphViewer
                ref={viewerRef}
                graphData={graphData}
                filters={filters}
                isDarkMode={isDarkMode}
                isPhysicsEnabled={true}
                colorMode="kind"
                onNodeClick={onNodeClick}
                showArrows={true}
                labelThreshold={12}
                nodeSize={1.2}
            />

            {/* Controls flotants */}
            <div className="absolute bottom-6 right-6 flex flex-col gap-2">
                <button 
                    onClick={() => viewerRef.current?.zoomIn()}
                    className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                    title="Zoom In"
                >
                    <ZoomIn size={18} />
                </button>
                <button 
                    onClick={() => viewerRef.current?.zoomOut()}
                    className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                    title="Zoom Out"
                >
                    <ZoomOut size={18} />
                </button>
                <button 
                    onClick={() => viewerRef.current?.center()}
                    className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                    title={t('graph.vault_embed.center_tooltip', 'Centrar')}
                >
                    <Target size={18} />
                </button>
            </div>

            {/* Active filters indicator */}
            {(view.filters?.length > 0 || searchTerm) && (
                <div className="absolute top-4 left-4 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 rounded-full flex items-center gap-2 pointer-events-none">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
                        {t('graph.vault_embed.filters_applied', 'Filtres de vista aplicats ({{n}})', { n: view.filters?.length || 0 })}
                    </span>
                </div>
            )}

            {/* Partial-graph warning: unreadable vault dirs were skipped by the
                backend (wedged cloud subtrees); retry re-attempts a full build. */}
            {graphData?.partial && (
                <div
                    className="absolute top-4 right-4 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700 rounded-full flex items-center gap-2 shadow-sm"
                    title={(graphData.skipped_dirs || []).join('\n')}
                >
                    <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                        {t('graph.partial_warning.title', 'Graf parcial')}
                    </span>
                    <button
                        onClick={fetchData}
                        className="text-xs font-semibold text-amber-700 dark:text-amber-300 underline hover:no-underline"
                    >
                        {t('graph.partial_warning.retry', 'Reintenta')}
                    </button>
                </div>
            )}
        </div>
    );
}

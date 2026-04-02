import React, { useEffect, useState, useRef, useMemo } from 'react';
import axios from 'axios';
import { GraphViewer } from '../GraphViewer';
import { Loader2, Settings2, Maximize2, ZoomIn, ZoomOut, Target } from 'lucide-react';
import { matchesFilters, matchesSearch } from '../../utils/vaultFilters';

/**
 * VaultGraph.jsx
 * Visualització de graf integrada al Vault Dashboard.
 * Respecta els filtres de la vista activa del Vault.
 */
export function VaultGraph({ 
    tableId, 
    view = {}, 
    searchTerm = '', 
    isDarkMode = false,
    onNodeClick
}) {
    const [graphData, setGraphData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState(null);
    const viewerRef = useRef(null);

    // Carregar dades del graf i configuració
    useEffect(() => {
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
                console.error("Error carregant dades del graf:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    // Preparar filtres basats en la vista activa del Vault
    const filters = useMemo(() => {
        const vaultFilters = view.filters || [];
        
        return {
            // Passem els filtres del vault directament
            vaultFilters,
            searchTerm,
            // Marquem que estem en mode "Vault View" per a la lògica de graphFilters.js
            isVaultMode: true,
            activeTableId: tableId
        };
    }, [view.filters, searchTerm, tableId]);

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900/50">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    <span className="text-sm text-gray-500">Construint graf...</span>
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
                    title="Centrar"
                >
                    <Target size={18} />
                </button>
            </div>

            {/* Indicador de filtres actius */}
            {(view.filters?.length > 0 || searchTerm) && (
                <div className="absolute top-4 left-4 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 rounded-full flex items-center gap-2 pointer-events-none">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
                        Filtres de vista aplicats ({view.filters?.length || 0})
                    </span>
                </div>
            )}
        </div>
    );
}

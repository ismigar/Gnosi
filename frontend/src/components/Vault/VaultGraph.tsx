import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { GraphViewer } from '../../shared/graph/viewer/GraphViewer';
import { AlertTriangle, Loader2, Target, ZoomIn, ZoomOut } from 'lucide-react';
import type { FilterNode } from '../../utils/vaultFilters';
import { useConfigChanged } from '../../lib/configEvents';
import {
    fetchConfiguration,
    type ConfigurationDocument,
} from '../../shared/api/configuration';
import type { VaultGraphData } from '../../shared/api/graph';
import { useVaultGraphData } from '../../shared/api/useGraphData';

/**
 * VaultGraph.jsx
 * Graph visualization embedded in the Vault Dashboard.
 * Respects the active Vault view's filters.
 */
interface VaultGraphView {
    readonly filters?: readonly FilterNode[] | null;
}

interface EmbeddedGraphFilters {
    readonly activeTableId?: string | null;
    readonly isVaultMode: true;
    readonly searchTerm: string;
    readonly vaultFilters: readonly FilterNode[];
}

export interface VaultGraphViewerHandle {
    center(): void;
    zoomIn(): void;
    zoomOut(): void;
}

interface EmbeddedGraphViewerProps {
    readonly colorMode: 'kind';
    readonly filters: EmbeddedGraphFilters;
    readonly graphData: VaultGraphData | null;
    readonly isDarkMode: boolean;
    readonly isPhysicsEnabled: true;
    readonly labelThreshold: number;
    readonly nodeSize: number;
    readonly onNodeClick?: (nodeId: string) => unknown;
    readonly ref: RefObject<VaultGraphViewerHandle | null>;
    readonly showArrows: true;
}

export interface VaultGraphProps {
    readonly isDarkMode?: boolean;
    readonly onNodeClick?: (nodeId: string) => unknown;
    readonly searchTerm?: string;
    readonly tableId?: string | null;
    readonly view?: VaultGraphView;
}

export function VaultGraph({
    tableId,
    view = {},
    searchTerm = '',
    isDarkMode = false,
    onNodeClick,
}: VaultGraphProps) {
    const { t } = useTranslation();
    const [, setConfig] = useState<ConfigurationDocument | null>(null);
    const viewerRef = useRef<VaultGraphViewerHandle | null>(null);
    const graphQuery = useVaultGraphData();
    const graphData = graphQuery.data || null;
    const loading = graphQuery.isLoading;

    // Load graph data and configuration. Defined outside the effect so the
    // partial-graph warning's retry button can re-trigger a full fetch.
    const fetchData = async (): Promise<void> => {
        try {
            const [, config] = await Promise.all([
                graphQuery.refetch(),
                fetchConfiguration()
            ]);
            setConfig(config);
        } catch { /* Preserve the existing silent UI on refresh failures. */ }
    };

    useEffect(() => {
        fetchConfiguration()
            .then(setConfig)
            .catch(() => undefined);
    }, []);

    // Re-fetch only the config when the Settings modals emit the event
    // (the graph itself doesn't change due to config changes).
    useConfigChanged(() => {
        void fetchConfiguration()
            .then(setConfig)
            .catch(() => undefined);
    });

    // Prepare filters based on the Vault's active view
    const filters = useMemo<EmbeddedGraphFilters>(() => {
        const vaultFilters = view.filters ?? [];
        
        return {
            // We pass the vault's filters directly
            vaultFilters,
            searchTerm,
            // We mark that we're in "Vault View" mode for the logic in graphFilters.js
            isVaultMode: true,
            activeTableId: tableId
        };
    }, [view.filters, searchTerm, tableId]);
    const activeFilterCount = view.filters?.length ?? 0;
    const graphViewerProps: EmbeddedGraphViewerProps = {
        ref: viewerRef,
        graphData,
        filters,
        isDarkMode,
        isPhysicsEnabled: true,
        colorMode: 'kind',
        onNodeClick,
        showArrows: true,
        labelThreshold: 12,
        nodeSize: 1.2,
    };

    if (loading) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900/50">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                    <span className="text-sm text-gray-500">{t('graph.vault_embed.building', "Building graph...")}</span>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 relative overflow-hidden bg-white dark:bg-gray-950">
            <GraphViewer {...graphViewerProps} />

            {/* Controls flotants */}
            <div className="absolute bottom-6 right-6 flex flex-col gap-2">
                <button 
                    onClick={() => {
                        viewerRef.current?.zoomIn();
                    }}
                    className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                    title="Zoom In"
                >
                    <ZoomIn size={18} />
                </button>
                <button 
                    onClick={() => {
                        viewerRef.current?.zoomOut();
                    }}
                    className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                    title="Zoom Out"
                >
                    <ZoomOut size={18} />
                </button>
                <button 
                    onClick={() => {
                        viewerRef.current?.center();
                    }}
                    className="p-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300"
                    title={t('graph.vault_embed.center_tooltip', "Center")}
                >
                    <Target size={18} />
                </button>
            </div>

            {/* Active filters indicator */}
            {(activeFilterCount > 0 || searchTerm) && (
                <div className="absolute top-4 left-4 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 rounded-full flex items-center gap-2 pointer-events-none">
                    <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
                    <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
                        {t('graph.vault_embed.filters_applied', "View filters applied ({{n}})", { n: activeFilterCount })}
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
                        {t('graph.partial_warning.title', "Partial graph")}
                    </span>
                    <button
                        onClick={() => {
                            void fetchData();
                        }}
                        className="text-xs font-semibold text-amber-700 dark:text-amber-300 underline hover:no-underline"
                    >
                        {t('graph.partial_warning.retry', "Retry")}
                    </button>
                </div>
            )}
        </div>
    );
}

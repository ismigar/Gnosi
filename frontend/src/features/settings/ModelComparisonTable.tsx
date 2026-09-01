import type { ReactNode, RefObject, UIEventHandler } from 'react';
import {
    ArrowDown,
    ArrowLeftRight,
    ArrowUp,
    ArrowUpDown,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
    AiModelCatalogProvider,
    AiModelComparison,
    AiModelComparisonEntry,
    AiModelRegistryEntry,
} from '../../shared/api/ai';
import {
    type ComparisonColumn,
    type ComparisonSort,
    type ComparisonSortKey,
    type MetricAvailability,
} from './modelComparison';
import { ModelComparisonRow } from './ModelComparisonRow';


interface ModelComparisonTableProps {
    readonly busyModelId: string;
    readonly columns: readonly ComparisonColumn[];
    readonly configurationError: string;
    readonly configurationLoading: boolean;
    readonly feed: AiModelComparison;
    readonly inputTokens: string;
    readonly metricAvailability: MetricAvailability;
    readonly models: readonly AiModelComparisonEntry[];
    readonly onBeginActivation: (model: AiModelComparisonEntry) => void;
    readonly onDeactivate: (model: AiModelComparisonEntry) => Promise<void>;
    readonly onScrollbarScroll: UIEventHandler<HTMLDivElement>;
    readonly onSort: (key: ComparisonSortKey) => void;
    readonly outputTokens: string;
    readonly providersById: Readonly<Record<string, AiModelCatalogProvider>>;
    readonly registryModels: readonly AiModelRegistryEntry[];
    readonly scrollbarRef: RefObject<HTMLDivElement | null>;
    readonly setupModelId: string | null;
    readonly setupPanel: ReactNode;
    readonly sort: ComparisonSort;
    readonly tableScrollWidth: number;
    readonly tableWrapRef: RefObject<HTMLDivElement | null>;
}


function SortIcon({
    column,
    sort,
}: {
    readonly column: ComparisonSortKey;
    readonly sort: ComparisonSort;
}) {
    if (sort.key !== column) return <ArrowUpDown size={14} />;
    return sort.direction === 'asc'
        ? <ArrowUp size={14} />
        : <ArrowDown size={14} />;
}


export function ModelComparisonTable({
    busyModelId,
    columns,
    configurationError,
    configurationLoading,
    feed,
    inputTokens,
    metricAvailability,
    models,
    onBeginActivation,
    onDeactivate,
    onScrollbarScroll,
    onSort,
    outputTokens,
    providersById,
    registryModels,
    scrollbarRef,
    setupModelId,
    setupPanel,
    sort,
    tableScrollWidth,
    tableWrapRef,
}: ModelComparisonTableProps) {
    const { t } = useTranslation();
    const tableMinWidth = Math.max(1050, 380 + ((columns.length - 1) * 125));

    return (
        <>
            <div
                aria-label={t('model_comparison.table_navigation')}
                className="model-table-controls"
            >
                <span>
                    <ArrowLeftRight size={16} />
                    {' '}
                    {t('model_comparison.table_scroll_hint')}
                    {' · '}
                    {t('model_comparison.keyboard_scroll_hint')}
                </span>
            </div>
            <div className="model-table-wrap" ref={tableWrapRef}>
                <table
                    className="model-comparison-table"
                    style={{ minWidth: `${tableMinWidth.toString()}px` }}
                >
                    <thead>
                        <tr>
                            {columns.map((column) => (
                                <th
                                    className={column.key === 'name'
                                        ? 'model-comparison-sticky-start'
                                        : ''}
                                    key={column.key}
                                >
                                    <button
                                        onClick={() => {
                                            onSort(column.key);
                                        }}
                                        type="button"
                                    >
                                        {t(`model_comparison.columns.${column.label}`, {
                                            symbol: feed.currency.symbol || '$',
                                        })}
                                        {' '}
                                        <SortIcon column={column.key} sort={sort} />
                                    </button>
                                </th>
                            ))}
                            <th>{t('model_comparison.columns.monthly_cost', {
                                symbol: feed.currency.symbol || '$',
                            })}</th>
                            <th className="model-comparison-sticky-end">
                                {t('model_comparison.columns.available')}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {models.map((model) => (
                            <ModelComparisonRow
                                busyModelId={busyModelId}
                                columns={columns}
                                configurationError={configurationError}
                                configurationLoading={configurationLoading}
                                feed={feed}
                                inputTokens={inputTokens}
                                key={model.id}
                                metricAvailability={metricAvailability}
                                model={model}
                                onBeginActivation={onBeginActivation}
                                onDeactivate={onDeactivate}
                                outputTokens={outputTokens}
                                providersById={providersById}
                                registryModels={registryModels}
                                setupModelId={setupModelId}
                                setupPanel={setupPanel}
                            />
                        ))}
                    </tbody>
                </table>
                {models.length === 0 ? (
                    <div className="model-comparison-empty">
                        {t('model_comparison.no_results')}
                    </div>
                ) : null}
            </div>
            <div
                aria-label={t('model_comparison.table_scroll_hint')}
                className="model-table-scrollbar"
                onScroll={onScrollbarScroll}
                ref={scrollbarRef}
            >
                <div style={{
                    height: '1px',
                    width: `${Math.max(tableScrollWidth, 1).toString()}px`,
                }} />
            </div>
            <p className="model-comparison-note">
                {t('model_comparison.data_note')}
                {' '}
                <a href={feed.source_url} rel="noreferrer" target="_blank">
                    Artificial Analysis ↗
                </a>
            </p>
        </>
    );
}

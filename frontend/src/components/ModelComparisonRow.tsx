import { Fragment, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { matchingRegistryIndexes } from '../lib/modelComparisonRegistry';
import type {
    AiModelCatalogProvider,
    AiModelComparison,
    AiModelComparisonEntry,
    AiModelRegistryEntry,
} from '../shared/api/ai';
import {
    formatComparisonContext,
    formatComparisonCost,
    formatComparisonMetric,
    isFiniteMetric,
    modelMonthlyCost,
    PROFILE_ICONS,
    type ComparisonColumn,
    type ComparisonProfile,
    type MetricAvailability,
} from './modelComparison';


interface ModelComparisonRowProps {
    readonly busyModelId: string;
    readonly columns: readonly ComparisonColumn[];
    readonly configurationError: string;
    readonly configurationLoading: boolean;
    readonly feed: AiModelComparison;
    readonly inputTokens: string;
    readonly metricAvailability: MetricAvailability;
    readonly model: AiModelComparisonEntry;
    readonly onBeginActivation: (model: AiModelComparisonEntry) => void;
    readonly onDeactivate: (model: AiModelComparisonEntry) => Promise<void>;
    readonly outputTokens: string;
    readonly providersById: Readonly<Record<string, AiModelCatalogProvider>>;
    readonly registryModels: readonly AiModelRegistryEntry[];
    readonly setupModelId: string | null;
    readonly setupPanel: ReactNode;
}


function CachedMetricMarker({
    field,
    model,
}: {
    readonly field: string;
    readonly model: AiModelComparisonEntry;
}) {
    const { t } = useTranslation();
    if (model.metric_sources?.[field] !== 'artificial_analysis_cache') return null;
    const title = t('model_comparison.metric_sources.artificial_analysis_cache');
    return (
        <span aria-label={title} className="metric-cached-marker" title={title}>
            ·
        </span>
    );
}


export function ModelComparisonRow({
    busyModelId,
    columns,
    configurationError,
    configurationLoading,
    feed,
    inputTokens,
    metricAvailability,
    model,
    onBeginActivation,
    onDeactivate,
    outputTokens,
    providersById,
    registryModels,
    setupModelId,
    setupPanel,
}: ModelComparisonRowProps) {
    const { t } = useTranslation();
    const currencySymbol = feed.currency.symbol || '$';
    const currencyRate = feed.currency.usd_rate || 1;
    const cost = modelMonthlyCost(model, inputTokens, outputTokens);
    const matchingIndexes = matchingRegistryIndexes(registryModels, model);
    const activeEntries = matchingIndexes
        .map((index) => registryModels[index])
        .filter((entry): entry is AiModelRegistryEntry => (
            entry !== undefined && entry.enabled !== false
        ));
    const isActive = activeEntries.length > 0;
    const routeLabel = activeEntries.map((entry) => (
        providersById[entry.provider]?.name || entry.provider
    )).filter(Boolean).join(', ');
    const isBusy = busyModelId === model.id;
    const sourceTitle = (field: string): string | undefined => {
        const source = model.metric_sources?.[field];
        return source ? t(`model_comparison.metric_sources.${source}`) : undefined;
    };

    return (
        <Fragment>
            <tr>
                <td className="model-comparison-sticky-start">
                    <strong>{model.name}</strong>
                    <small>{model.release_date || '—'}</small>
                </td>
                <td>{model.creator || '—'}</td>
                <td>
                    <div className="model-mode-list">
                        {model.modes.map((mode) => (
                            <span key={mode}>
                                {t(`model_comparison.modes_list.${mode}`)}
                            </span>
                        ))}
                    </div>
                </td>
                {metricAvailability.intelligence ? (
                    <td title={sourceTitle('intelligence')}>
                        {formatComparisonMetric(model.intelligence)}
                        <CachedMetricMarker field="intelligence" model={model} />
                    </td>
                ) : null}
                {metricAvailability.coding ? (
                    <td title={sourceTitle('coding')}>
                        {formatComparisonMetric(model.coding)}
                        <CachedMetricMarker field="coding" model={model} />
                    </td>
                ) : null}
                {metricAvailability.agentic ? (
                    <td title={sourceTitle('agentic')}>
                        {formatComparisonMetric(model.agentic)}
                        <CachedMetricMarker field="agentic" model={model} />
                    </td>
                ) : null}
                <td title={sourceTitle('input_price')}>
                    {model.input_price === null
                        ? '—'
                        : formatComparisonCost(
                            model.input_price * currencyRate,
                            currencySymbol,
                        )}
                    <CachedMetricMarker field="input_price" model={model} />
                </td>
                <td title={sourceTitle('output_price')}>
                    {model.output_price === null
                        ? '—'
                        : formatComparisonCost(
                            model.output_price * currencyRate,
                            currencySymbol,
                        )}
                    <CachedMetricMarker field="output_price" model={model} />
                </td>
                <td title={sourceTitle('context_window')}>
                    {formatComparisonContext(model.context_window)}
                    <CachedMetricMarker field="context_window" model={model} />
                </td>
                {metricAvailability.speed ? (
                    <td title={sourceTitle('speed')}>
                        {isFiniteMetric(model.speed)
                            ? `${formatComparisonMetric(model.speed)} t/s`
                            : '—'}
                        <CachedMetricMarker field="speed" model={model} />
                    </td>
                ) : null}
                {metricAvailability.latency ? (
                    <td title={sourceTitle('latency')}>
                        {isFiniteMetric(model.latency)
                            ? `${formatComparisonMetric(model.latency, 2)} s`
                            : '—'}
                        <CachedMetricMarker field="latency" model={model} />
                    </td>
                ) : null}
                {metricAvailability.profile ? (
                    <td>
                        <span className={`model-profile-badge ${model.profile}`}>
                            {PROFILE_ICONS[model.profile as ComparisonProfile] ?? '⚪'}
                            {' '}
                            {t(`model_comparison.profiles.${model.profile}`)}
                        </span>
                    </td>
                ) : null}
                <td>
                    <strong>{cost === null
                        ? '—'
                        : formatComparisonCost(
                            cost * currencyRate,
                            currencySymbol,
                        )}</strong>
                </td>
                <td className="model-comparison-sticky-end">
                    <div className="model-availability-cell">
                        <button
                            aria-checked={isActive}
                            aria-label={t(
                                isActive
                                    ? 'model_comparison.disable_model'
                                    : 'model_comparison.enable_model',
                                { model: model.name },
                            )}
                            className={`model-availability-toggle ${isActive ? 'active' : ''}`}
                            disabled={configurationLoading
                                || Boolean(configurationError)
                                || isBusy}
                            onClick={() => {
                                if (isActive) void onDeactivate(model);
                                else onBeginActivation(model);
                            }}
                            role="switch"
                            type="button"
                        >
                            {isBusy ? (
                                <Loader2 className="animate-spin" size={15} />
                            ) : <span />}
                        </button>
                        <small title={routeLabel}>
                            {configurationLoading
                                ? t('model_comparison.configuration_loading')
                                : isActive
                                    ? routeLabel || t('model_comparison.active')
                                    : t('model_comparison.inactive')}
                        </small>
                    </div>
                </td>
            </tr>
            {setupModelId === model.id ? (
                <tr className="model-setup-row">
                    <td className="model-setup-cell" colSpan={columns.length + 2}>
                        {setupPanel}
                    </td>
                </tr>
            ) : null}
        </Fragment>
    );
}

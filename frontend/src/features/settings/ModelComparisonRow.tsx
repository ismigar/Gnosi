import { ModelParameterReview } from './model-comparison/ModelParameterReview';
import { ModelAliasField } from './ModelAliasField';
import { modelParameterDisclosure, modelParameterMetadata } from './model-comparison/modelParameters';
import { Fragment, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { matchingRegistryIndexes } from './model-comparison/modelComparisonRegistry';
import type {
    AiModelCatalogProvider,
    AiModelComparison,
    AiModelComparisonEntry,
    AiModelRegistryEntry,
} from '../../shared/api/ai';
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
    readonly onParameterUpdate?: () => void;
    readonly busyModelId: string;
    readonly columns: readonly ComparisonColumn[];
    readonly configurationError: string;
    readonly configurationLoading: boolean;
    readonly feed: AiModelComparison;
    readonly inputTokens: string;
    readonly metricAvailability: MetricAvailability;
    readonly model: AiModelComparisonEntry;
    readonly onBeginActivation: (model: AiModelComparisonEntry) => void;
    readonly onSaveAlias?: (entry: AiModelRegistryEntry, alias: string) => Promise<void>;
    readonly onDeactivate: (model: AiModelComparisonEntry) => Promise<void>;
    readonly selectedProfile?: 'all' | ComparisonProfile;
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
    onParameterUpdate,
    busyModelId,
    columns,
    configurationError,
    configurationLoading,
    feed,
    inputTokens,
    model,
    onBeginActivation,
    onSaveAlias,
    onDeactivate,
    selectedProfile = 'all',
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

    const parameters = modelParameterMetadata(model);
    const disclosure = modelParameterDisclosure(model);
    const assessments = (model.role_assessments ?? []).filter(r => selectedProfile === 'all' || selectedProfile === 'unrated' || r.role === selectedProfile);
    const renderCell = (key: ComparisonColumn['key']): ReactNode => {
        switch (key) {
            case 'name': return <><strong title={model.name}>{model.name}</strong><small>{model.release_date || '—'}</small>{onSaveAlias && activeEntries.map(entry => <ModelAliasField key={`${entry.provider}:${entry.model_id}`} entry={entry} onSave={onSaveAlias} disabled={isBusy} />)}</>;
            case 'provider': return [...new Set(model.routes.map(route => providersById[route.provider]?.name || route.provider))].sort().join(', ') || '—';
            case 'creator': return model.creator || '—';
            case 'modes': return <div className="model-mode-list">{model.modes.map((mode) => (
                <span key={mode}>{t(`model_comparison.modes_list.${mode}`)}</span>
            ))}</div>;
            case 'parameters': return parameters ? <>
                <a href={parameters.source} rel="noreferrer" target="_blank"
                    title={`${t(parameters.verification === 'user_review' ? 'model_comparison.review_manual' : 'model_comparison.parameters_source')} · ${t('model_comparison.parameters_checked', { date: parameters.checkedAt })}`}>
                    {formatComparisonMetric(parameters.total)} B
                </a>
                {parameters.active !== undefined && <small>{t('model_comparison.parameters_active', {
                    count: parameters.active,
                    value: formatComparisonMetric(parameters.active),
                })}</small>}
            </> : disclosure.status === 'not_published' ? <a href={disclosure.source}
                target="_blank" rel="noreferrer" title={`${t('model_comparison.parameters_not_published_help')} · ${t('model_comparison.parameters_checked', { date: disclosure.checkedAt })}`}>
                {t('model_comparison.parameters_not_published')}
            </a> : <ModelParameterReview modelId={model.id} modelName={model.name} onUpdated={onParameterUpdate} />;
            case 'context_window': return formatComparisonContext(model.context_window);
            case 'input_price':
            case 'output_price': return isFiniteMetric(model[key])
                ? formatComparisonCost(model[key] * currencyRate, currencySymbol) : '—';
            case 'monthly_cost': return <strong>{cost === null ? '—'
                : formatComparisonCost(cost * currencyRate, currencySymbol)}</strong>;
            case 'speed': return isFiniteMetric(model.speed)
                ? `${formatComparisonMetric(model.speed)} tokens/s` : '—';
            case 'latency': return isFiniteMetric(model.latency)
                ? `${formatComparisonMetric(model.latency, 2)} s` : '—';
            case 'profile': return model.role_assessments?.length ? <><details className="model-role-assessments"><summary>{assessments.filter(r => ['catalog_compatible', 'tested'].includes(r.status)).map(r => `${t(`model_comparison.profiles.${r.role}`)}${r.score != null ? ` · ${formatComparisonMetric(r.score)}%` : ''}`).join(', ') || t('agent_team.insufficient_data')}</summary>
                <div className="model-role-assessments__body"><p className="settings-desc">{t('agent_team.scoring_help')}</p>
                {assessments.map(r => <p key={r.role}><strong>{t(`model_comparison.profiles.${r.role}`)}</strong>: {t(`agent_team.${r.status}`)}<br />
                    {t('agent_team.role_score')}: {r.score != null ? `${formatComparisonMetric(r.score)}%` : '—'} · {t('agent_team.data_coverage')}: {r.coverage}%<br />
                    {r.evaluation_score != null && <span>{t('agent_team.lab_measured')}: {r.evaluation_score}% · {r.evaluation_date}<br />{t('agent_team.lab_blend')}<br /></span>}
                    {t('agent_team.source')}: {t(`agent_team.sources.${r.source}`)} · {r.checked_at ?? t('agent_team.unknown_date')}<br />
                    {t('agent_team.evidence')}: {(r.evidence ?? []).map(item => t(`agent_team.metrics.${item}`, { defaultValue: item })).join(', ')}<br />
                    {(r.proofs ?? []).map(proof => <span key={`${proof.source}:${proof.metric}`}>{t(`agent_team.metrics.${proof.metric}`, { defaultValue: proof.metric })}: {String(proof.value)} ({t(`agent_team.sources.${proof.source}`)}; {t('agent_team.weight')}: {Math.round((r.weights?.[proof.metric] ?? 0) * 100)}%)<br /></span>)}
                    {t('agent_team.missing_catalog')}: {(r.missing ?? []).filter(item => item in (r.weights ?? {})).map(item => t(`agent_team.metrics.${item}`, { defaultValue: item })).join(', ') || '—'}<br />
                    <span className="settings-desc">{t('agent_team.obtain_catalog')}</span><br />
                    {t('agent_team.missing')}: {(r.missing ?? []).filter(item => !(item in (r.weights ?? {}))).map(item => t(`agent_team.metrics.${item}`, { defaultValue: item })).join(', ')}<br />
                    <span className="settings-desc">{t(`agent_team.verify_roles.${r.role}`)} {t('agent_team.verification_pending')}</span>
                </p>)}</div>
            </details>{selectedProfile !== 'all' && selectedProfile !== 'unrated' && assessments.map(r => <small key={r.role}>{t('model_comparison.estimated_fit')} · {t('agent_team.data_coverage')}: {r.coverage}%</small>)}</> : <span className={`model-profile-badge ${model.profile}`}>
                {PROFILE_ICONS[model.profile as ComparisonProfile] ?? '⚪'}{' '}
                {t(`model_comparison.profiles.${model.profile}`)}
            </span>;
            default: return formatComparisonMetric(model[key]);
        }
    };

    return (
        <Fragment>
            <tr>
                {columns.map((column) => (
                    <td
                        className={column.key === 'name' ? 'model-comparison-sticky-start' : undefined}
                        key={column.key}
                        title={sourceTitle(column.key)}
                    >
                        {renderCell(column.key)}
                        <CachedMetricMarker field={column.key} model={model} />
                    </td>
                ))}
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
                    <td className="model-setup-cell" colSpan={columns.length + 1}>
                        {setupPanel}
                    </td>
                </tr>
            ) : null}
        </Fragment>
    );
}

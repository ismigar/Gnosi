import type { NormalizedSkill } from './AI/aiSettingsUtils';
import { botModelDemand } from './model-comparison/botModelDemand';
import { AgentEvaluationLab } from './AI/AgentEvaluationLab';
import { ModelTaskRecommendations, type TaskRecommendationDraft } from './model-comparison/ModelTaskRecommendations';
import { useMemo, useReducer, useState, useCallback, type CSSProperties } from 'react';
import { Bot, FlaskConical, List, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../shared/hooks/useModalKeyboard';
import './AIModelComparisonModal.css';
import { SettingsSectionTabs } from '../../shared/ui/settings/SettingsSectionTabs';
import { ModelBotContext } from './model-comparison/ModelBotContext';
import { isSuspendedPluginProfile, principalAssistant, profileDisplayName } from '../../shared/ai/assistantProfiles';
import type { SettingsAgent } from './global-settings/types';
import type { AiModelComparisonEntry } from '../../shared/api/ai';
import {
    filteredComparisonModels,
    INITIAL_COMPARISON_UI_STATE,
    modelComparisonColumns,
    modelComparisonUiReducer,
    modelMetricAvailability,
} from './modelComparison';
import { ModelComparisonSetupPanel } from './ModelComparisonSetupPanel';
import { ModelComparisonStatus } from './ModelComparisonStatus';
import { ModelComparisonTable } from './ModelComparisonTable';
import { ModelComparisonToolbar } from './ModelComparisonToolbar';
import { useModelComparisonData } from './useModelComparisonData';
import { useModelComparisonLayout } from './useModelComparisonLayout';
import { comparisonRouteKey } from './model-comparison/modelComparisonRegistry';


export interface AIModelComparisonModalProps {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly bots?: readonly SettingsAgent[];
    readonly skillCatalog?: readonly NormalizedSkill[];
    readonly skillCatalogStatus?: 'ready' | 'loading' | 'error';
    readonly principalId?: string;
    readonly onAssignModel?: (botId: string, provider: string, model: string) => void;
    readonly onConfigureBot?: (id: string) => void;
    readonly saveStatus?: string;
}


type FilterHeightStyle = CSSProperties & {
    readonly '--filter-sticky-height': string;
};


export function AIModelComparisonModal({
    isOpen,
    onClose, bots = [], skillCatalog = [], skillCatalogStatus = 'ready', principalId = '', onAssignModel, onConfigureBot, saveStatus,
}: AIModelComparisonModalProps) {
    const { t } = useTranslation();
    const [taskDrafts, setTaskDrafts] = useState<Record<string, TaskRecommendationDraft>>({});
    const [tab, setTab] = useState('bots');
    const [labVisited, setLabVisited] = useState(false);
    const [botId, setBotId] = useState(principalId);
    const [offerProvider, setOfferProvider] = useState('configured');
    const visibleBots = bots.filter(bot => !isSuspendedPluginProfile(bot));
    const principal = principalAssistant(visibleBots, principalId);
    const bot = visibleBots.find(item => item.id === botId) ?? principal ?? visibleBots.at(0);
    const demand = botModelDemand(bot, principal?.id ?? principalId, skillCatalog);
    const draftKey = bot?.id ?? 'general';
    const rememberDraft = useCallback((draft: TaskRecommendationDraft) => {
        setTaskDrafts(previous => JSON.stringify(previous[draftKey]) === JSON.stringify(draft) ? previous : { ...previous, [draftKey]: draft });
    }, [draftKey]);
    const [evidenceRevision, setEvidenceRevision] = useState(0);
    const [ui, dispatchUi] = useReducer(
        modelComparisonUiReducer,
        INITIAL_COMPARISON_UI_STATE,
    );
    const controller = useModelComparisonData(isOpen);
    const { state: data } = controller;
    const {
        bodyRef,
        filterHeight,
        modalRef,
        onScrollbarScroll,
        profileHelpRef,
        scrollbarRef,
        tableScrollWidth,
        tableWrapRef,
        toolbarRef,
    } = useModelComparisonLayout(isOpen, useMemo(() => ({ feed: data.feed, tab }), [data.feed, tab]));

    useModalKeyboard({
        containerRef: modalRef,
        isOpen,
        onClose: () => {
            if (data.setup) controller.closeSetup();
            else onClose();
        },
        trapFocus: true,
    });
    useModalKeyboard({
        containerRef: profileHelpRef,
        isOpen: isOpen && ui.showProfileHelp,
        onClose: () => {
            dispatchUi({ type: 'set-show-profile-help', value: false });
        },
        trapFocus: true,
    });

    const metricAvailability = useMemo(
        () => modelMetricAvailability(data.feed),
        [data.feed],
    );
    const columns = useMemo(
        () => modelComparisonColumns(metricAvailability),
        [metricAvailability],
    );
    const models = useMemo(() => filteredComparisonModels(
        data.feed,
        data.registry.models,
        ui,
    ), [data.feed, data.registry.models, ui]);
    const configuredProviders = new Set(data.registry.models.filter(row => row.enabled).map(row => row.provider));
    for (const [id, provider] of Object.entries(controller.providersById)) {
        if (provider.has_api_key || provider.connected) configuredProviders.add(id);
    }
    const taskModels = (data.feed?.models ?? []).map(model => ({ ...model, routes: model.routes.filter(route =>
        offerProvider === 'all' || (offerProvider === 'configured' ? configuredProviders.has(route.provider) : route.provider === offerProvider)) }));
    const beginActivation = (model: AiModelComparisonEntry, provider?: string) => {
        controller.beginActivation(model, provider);
        bodyRef.current?.scrollTo({ top: 0 });
    };
    const providerOptions = useMemo(() => {
        const providers = new Map<string, string>();
        for (const model of data.feed?.models ?? []) {
            for (const route of model.routes) providers.set(route.provider, route.provider_name || route.provider);
        }
        return [...providers].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
    }, [data.feed]);
    const bodyStyle: FilterHeightStyle = {
        '--filter-sticky-height': `${filterHeight.toString()}px`,
    };
    const setupPanel = data.setup ? (
        <ModelComparisonSetupPanel
            relatedBenchmarks={(data.feed?.models ?? []).filter(model => model.routes.some(route =>
                data.setup?.routeKey === comparisonRouteKey(route))).map(model => model.name)}
            busyModelId={data.busyModelId}
            onAliasChange={controller.setSetupAlias}
            onApiKeyChange={controller.setSetupApiKey}
            onBaseUrlChange={controller.setSetupBaseUrl}
            onCancel={controller.closeSetup}
            onModeChange={controller.changeSetupMode}
            onProviderChange={controller.changeSetupProvider}
            onTestConnection={controller.testSetupConnection}
            providersById={controller.providersById}
            routesForMode={controller.routesForMode}
            setup={data.setup}
            tableViewportWidth={0}
        />
    ) : null;

    if (!isOpen) return null;

    return (
        <div className="model-comparison-layer" role="presentation">
            <div className="model-comparison-backdrop" />
            <section
                aria-labelledby="model-comparison-title"
                aria-modal="true"
                className="model-comparison-modal"
                ref={modalRef}
                role="dialog"
            >
                <header className="model-comparison-header">
                    <div>
                        <h2 id="model-comparison-title">
                            {t('model_comparison.title')}
                        </h2>
                    </div>
                    <button
                        aria-label={t('model_comparison.close')}
                        className="gnosi-close-btn"
                        onClick={onClose}
                        type="button"
                    >
                        <X />
                    </button>
                </header>

                <div
                    aria-label={t('model_comparison.keyboard_scroll_hint')}
                    className="model-comparison-body"
                    data-autofocus
                    ref={bodyRef}
                    style={bodyStyle}
                    tabIndex={0}
                >
                    <ModelComparisonStatus
                        actionMessage={data.actionMessage}
                        apiKeyInput={data.apiKeyInput}
                        configurationError={data.configurationError}
                        errorCode={data.errorCode}
                        fallbackNoticeDismissed={data.fallbackNoticeDismissed}
                        feed={data.feed}
                        loading={data.loading}
                        onApiKeyInputChange={controller.setApiKeyInput}
                        onDismissFallback={controller.dismissFallback}
                        onRetry={controller.retry}
                        onSaveApiKey={controller.saveArtificialAnalysisApiKey}
                        savingApiKey={data.savingApiKey}
                    />

                    {!data.loading && data.feed ? (
                        <>
                            <ModelBotContext key={bot?.id ?? 'general'} disabled={data.configurationLoading || Boolean(data.configurationError) || skillCatalogStatus !== 'ready'} bots={visibleBots} bot={bot} onBotChange={setBotId} registry={data.registry.models}
                                onAssign={onAssignModel} onConfigure={onConfigureBot} saveStatus={saveStatus} />
                            <SettingsSectionTabs activeId={tab} ariaLabel={t('model_comparison.workspace.sections')}
                                items={[
                                    { id: 'bots', icon: Bot, label: t('model_comparison.workspace.choose') },
                                    { id: 'catalogue', icon: List, label: t('model_comparison.workspace.catalogue') },
                                    { id: 'tests', icon: FlaskConical, label: t('model_comparison.workspace.tests') },
                                ]} onChange={id => { setTab(id); if (id === 'tests') setLabVisited(true); dispatchUi({ type: 'set-show-profile-help', value: false }); bodyRef.current?.scrollTo({ top: 0 }); }} />
                            {setupPanel && <section className="model-choice-setup">
                                <h3>{t('model_comparison.workspace.configure_offer')} · {data.setup?.model.name}</h3>
                                {setupPanel}
                            </section>}
                            {tab === 'bots' && <>
                                <p className="settings-desc">{t('model_comparison.workspace.choose_help')}</p>
                                {skillCatalogStatus !== 'ready' && <p role={skillCatalogStatus === 'error' ? 'alert' : 'status'}>{t(`model_comparison.workspace.skills_${skillCatalogStatus}`)}</p>}
                                <label className="model-setup-field model-bot-provider">{t('settings.ai.provider')}
                                    <select className="gnosi-select" value={offerProvider} onChange={event => { setOfferProvider(event.target.value); }}>
                                        <option value="configured">{t('model_comparison.workspace.configured_providers')}</option>
                                        <option value="all">{t('model_comparison.all_providers')}</option>
                                        {providerOptions.map(provider => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                                    </select>
                                </label>
                                <ModelTaskRecommendations key={bot?.id ?? 'general'} profile="all" initialTask={demand.tasks[0]} botDemand={bot ? demand : undefined} provider={offerProvider === 'configured' ? 'all' : offerProvider}
                                    initialDraft={taskDrafts[draftKey]} onDraftChange={rememberDraft}
                                    models={taskModels} feed={data.feed} revision={evidenceRevision} registry={data.registry.models}
                                    botName={bot ? profileDisplayName(bot, t) || bot.id : undefined} disabled={data.configurationLoading || Boolean(data.configurationError) || skillCatalogStatus !== 'ready' || saveStatus === 'saving'}
                                    onConfigure={candidate => { beginActivation({ ...candidate.model, routes: [candidate.offer.route] }, candidate.offer.route.provider); }}
                                    onAssign={bot && onAssignModel ? candidate => { onAssignModel(bot.id, candidate.offer.route.provider, candidate.offer.route.model_id); } : undefined} />
                            </>}
                            {labVisited && <div hidden={tab !== 'tests'}>
                                <p className="settings-desc">{t('model_comparison.workspace.tests_help')}</p>
                                <AgentEvaluationLab onComplete={() => { setEvidenceRevision(value => value + 1); controller.retry(); }} />
                            </div>}
                            {tab === 'catalogue' && <>
                            <ModelComparisonToolbar providers={providerOptions}
                                currencySymbol={data.feed.currency.symbol || data.feed.currency.code} dispatch={dispatchUi}
                                metricAvailability={metricAvailability} profileHelpRef={profileHelpRef} state={ui} toolbarRef={toolbarRef} />
                            <p className="settings-desc" role="status">
                                {t('model_comparison.results_count', { count: models.length })}
                            </p>
                            <ModelComparisonTable
                                onParameterUpdate={controller.retry}
                                busyModelId={data.busyModelId}
                                columns={columns}
                                configurationError={data.configurationError}
                                configurationLoading={data.configurationLoading}
                                feed={data.feed}
                                inputTokens={ui.inputTokens}
                                metricAvailability={metricAvailability}
                                models={models}
                                onBeginActivation={(model) => { beginActivation(model, ui.provider === 'all' ? undefined : ui.provider); }}
                                onSaveAlias={controller.saveModelAlias}
                                onDeactivate={controller.deactivateModel}
                                onScrollbarScroll={onScrollbarScroll}
                                onSort={(key) => {
                                    dispatchUi({ key, type: 'change-sort' });
                                }}
                                selectedProvider={ui.provider}
                                selectedProfile={ui.profile}
                                outputTokens={ui.outputTokens}
                                providersById={controller.providersById}
                                registryModels={data.registry.models}
                                scrollbarRef={scrollbarRef}
                                setupModelId={null}
                                setupPanel={null}
                                sort={ui.sort}
                                tableScrollWidth={tableScrollWidth}
                                tableWrapRef={tableWrapRef}
                            />
                            </>}
                        </>
                    ) : null}
                </div>
            </section>
        </div>
    );
}


export default AIModelComparisonModal;

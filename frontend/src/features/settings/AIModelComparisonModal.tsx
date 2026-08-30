import { useMemo, useReducer, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useModalKeyboard } from '../../shared/hooks/useModalKeyboard';
import './AIModelComparisonModal.css';
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


export interface AIModelComparisonModalProps {
    readonly isOpen: boolean;
    readonly onClose: () => void;
}


type FilterHeightStyle = CSSProperties & {
    readonly '--filter-sticky-height': string;
};


export function AIModelComparisonModal({
    isOpen,
    onClose,
}: AIModelComparisonModalProps) {
    const { t } = useTranslation();
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
        tableViewportWidth,
        tableWrapRef,
        toolbarRef,
    } = useModelComparisonLayout(isOpen, data.feed);

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
    const bodyStyle: FilterHeightStyle = {
        '--filter-sticky-height': `${filterHeight.toString()}px`,
    };
    const setupPanel = data.setup ? (
        <ModelComparisonSetupPanel
            busyModelId={data.busyModelId}
            onActivate={controller.activateModel}
            onApiKeyChange={controller.setSetupApiKey}
            onBaseUrlChange={controller.setSetupBaseUrl}
            onCancel={controller.closeSetup}
            onModeChange={controller.changeSetupMode}
            onProviderChange={controller.changeSetupProvider}
            providersById={controller.providersById}
            routesForMode={controller.routesForMode}
            setup={data.setup}
            tableViewportWidth={tableViewportWidth}
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
                            <ModelComparisonToolbar
                                dispatch={dispatchUi}
                                metricAvailability={metricAvailability}
                                profileHelpRef={profileHelpRef}
                                state={ui}
                                toolbarRef={toolbarRef}
                            />
                            <ModelComparisonTable
                                busyModelId={data.busyModelId}
                                columns={columns}
                                configurationError={data.configurationError}
                                configurationLoading={data.configurationLoading}
                                feed={data.feed}
                                inputTokens={ui.inputTokens}
                                metricAvailability={metricAvailability}
                                models={models}
                                onBeginActivation={controller.beginActivation}
                                onDeactivate={controller.deactivateModel}
                                onScrollbarScroll={onScrollbarScroll}
                                onSort={(key) => {
                                    dispatchUi({ key, type: 'change-sort' });
                                }}
                                outputTokens={ui.outputTokens}
                                providersById={controller.providersById}
                                registryModels={data.registry.models}
                                scrollbarRef={scrollbarRef}
                                setupModelId={data.setup?.model.id ?? null}
                                setupPanel={setupPanel}
                                sort={ui.sort}
                                tableScrollWidth={tableScrollWidth}
                                tableWrapRef={tableWrapRef}
                            />
                        </>
                    ) : null}
                </div>
            </section>
        </div>
    );
}


export default AIModelComparisonModal;

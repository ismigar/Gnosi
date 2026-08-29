import { CheckCircle2, Loader2, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AiModelComparison } from '../shared/api/ai';
import type { ModelActionMessage } from './modelComparison';


interface ModelComparisonStatusProps {
    readonly actionMessage: ModelActionMessage | null;
    readonly apiKeyInput: string;
    readonly configurationError: string;
    readonly errorCode: string;
    readonly fallbackNoticeDismissed: boolean;
    readonly feed: AiModelComparison | null;
    readonly loading: boolean;
    readonly onApiKeyInputChange: (value: string) => void;
    readonly onDismissFallback: () => void;
    readonly onRetry: () => void;
    readonly onSaveApiKey: () => Promise<void>;
    readonly savingApiKey: boolean;
}


const displayScalar = (value: unknown): string | null => {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
        return value.toString();
    }
    return null;
};


export function ModelComparisonStatus({
    actionMessage,
    apiKeyInput,
    configurationError,
    errorCode,
    fallbackNoticeDismissed,
    feed,
    loading,
    onApiKeyInputChange,
    onDismissFallback,
    onRetry,
    onSaveApiKey,
    savingApiKey,
}: ModelComparisonStatusProps) {
    const { t } = useTranslation();
    const indexVersion = displayScalar(feed?.intelligence_index_version);

    if (loading) {
        return (
            <div className="model-comparison-status" role="status">
                <Loader2 className="animate-spin" size={28} />
                <strong>{t('model_comparison.loading')}</strong>
                <span>{t('model_comparison.loading_description')}</span>
            </div>
        );
    }
    if (errorCode) {
        return (
            <div className="model-comparison-status error" role="alert">
                <strong>{t(
                    `model_comparison.errors.${errorCode}`,
                    t('model_comparison.errors.upstream_error'),
                )}</strong>
                <span>{t('model_comparison.errors.help')}</span>
                <a
                    className="model-comparison-api-link"
                    href="https://artificialanalysis.ai/data-api"
                    rel="noreferrer"
                    target="_blank"
                >
                    {t('model_comparison.get_api_key')} ↗
                </a>
                <div className="model-comparison-key-form">
                    <label>
                        <span>{t('model_comparison.api_key_label')}</span>
                        <input
                            autoComplete="off"
                            onChange={(event) => {
                                onApiKeyInputChange(event.target.value);
                            }}
                            placeholder={t('model_comparison.api_key_placeholder')}
                            type="password"
                            value={apiKeyInput}
                        />
                    </label>
                    <button
                        className="btn-gnosi-primary"
                        disabled={!apiKeyInput.trim() || savingApiKey}
                        onClick={() => {
                            void onSaveApiKey();
                        }}
                        type="button"
                    >
                        {savingApiKey ? (
                            <Loader2 className="animate-spin" size={17} />
                        ) : null}
                        {t('model_comparison.save_and_load')}
                    </button>
                </div>
                <button
                    className="btn-gnosi-primary"
                    onClick={onRetry}
                    type="button"
                >
                    <RefreshCw size={17} />
                    {t('model_comparison.retry')}
                </button>
            </div>
        );
    }
    if (!feed) return null;

    return (
        <>
            <div className="model-comparison-meta">
                <strong>{t('model_comparison.model_count', {
                    count: feed.count,
                })}</strong>
                <span>{t('model_comparison.updated_at', {
                    date: new Date(feed.fetched_at).toLocaleString(),
                })}</span>
                {indexVersion ? (
                    <span>{t('model_comparison.index_version', {
                        version: indexVersion,
                    })}</span>
                ) : null}
            </div>

            {feed.fallback && !fallbackNoticeDismissed ? (
                <div className="model-configuration-banner warning" role="status">
                    <span>{t(
                        feed.stale
                            ? 'model_comparison.cached_fallback'
                            : feed.retry_at
                                ? 'model_comparison.catalog_fallback_no_cache_until'
                                : 'model_comparison.catalog_fallback_no_cache',
                        {
                            date: feed.retry_at
                                ? new Date(feed.retry_at).toLocaleString()
                                : '',
                            source: feed.source,
                        },
                    )}</span>
                    <button
                        aria-label={t('model_comparison.close')}
                        onClick={onDismissFallback}
                        type="button"
                    >
                        <X size={15} />
                    </button>
                </div>
            ) : null}

            {configurationError ? (
                <div className="model-configuration-banner error" role="alert">
                    {t(`model_comparison.errors.${configurationError}`)}
                </div>
            ) : null}
            {actionMessage ? (
                <div
                    className={`model-configuration-banner ${actionMessage.type}`}
                    role="status"
                >
                    {actionMessage.type === 'success' ? (
                        <CheckCircle2 size={16} />
                    ) : null}
                    {t(`model_comparison.${actionMessage.key}`, {
                        model: actionMessage.model,
                        provider: actionMessage.provider,
                    })}
                </div>
            ) : null}
        </>
    );
}

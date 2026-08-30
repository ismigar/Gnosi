import { CheckCircle2, Cloud, Loader2, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ResolvedComparisonRoute } from './model-comparison/modelComparisonRegistry';
import type {
    AiModelCatalogProvider,
    AiModelComparisonEntry,
} from '../../shared/api/ai';
import type {
    ComparisonSetupMode,
    ModelSetupState,
} from './modelComparison';


interface ModelComparisonSetupPanelProps {
    readonly busyModelId: string;
    readonly onActivate: () => Promise<void>;
    readonly onApiKeyChange: (value: string) => void;
    readonly onBaseUrlChange: (value: string) => void;
    readonly onCancel: () => void;
    readonly onModeChange: (mode: ComparisonSetupMode) => void;
    readonly onProviderChange: (providerId: string) => void;
    readonly providersById: Readonly<Record<string, AiModelCatalogProvider>>;
    readonly routesForMode: (
        model: AiModelComparisonEntry,
        mode: ComparisonSetupMode,
    ) => readonly ResolvedComparisonRoute[];
    readonly setup: ModelSetupState;
    readonly tableViewportWidth: number;
}


export function ModelComparisonSetupPanel({
    busyModelId,
    onActivate,
    onApiKeyChange,
    onBaseUrlChange,
    onCancel,
    onModeChange,
    onProviderChange,
    providersById,
    routesForMode,
    setup,
    tableViewportWidth,
}: ModelComparisonSetupPanelProps) {
    const { t } = useTranslation();
    const provider = providersById[setup.providerId];
    const routes = routesForMode(setup.model, setup.mode);
    const route = routes.find((candidate) => (
        candidate.provider === setup.providerId
    ));
    const modes = (['remote', 'local'] as const).filter((mode) => (
        routesForMode(setup.model, mode).length > 0
    ));
    const needsApiKey = setup.mode === 'remote'
        && Boolean(provider)
        && !provider?.has_api_key;

    return (
        <section
            aria-label={t('model_comparison.setup.activate')}
            className="model-setup-dialog model-setup-inline"
            style={tableViewportWidth > 0
                ? { width: `${tableViewportWidth.toString()}px` }
                : undefined}
        >
            <div className="model-setup-content">
                {modes.length > 1 ? (
                    <fieldset className="model-execution-choice">
                        <legend>{t('model_comparison.setup.execution')}</legend>
                        <button
                            className={setup.mode === 'remote' ? 'active' : ''}
                            onClick={() => {
                                onModeChange('remote');
                            }}
                            type="button"
                        >
                            <Cloud size={20} />
                            <span>
                                <strong>{t('model_comparison.setup.remote')}</strong>
                                <small>{t('model_comparison.setup.remote_help')}</small>
                            </span>
                        </button>
                        <button
                            className={setup.mode === 'local' ? 'active' : ''}
                            onClick={() => {
                                onModeChange('local');
                            }}
                            type="button"
                        >
                            <Server size={20} />
                            <span>
                                <strong>{t('model_comparison.setup.local')}</strong>
                                <small>{t('model_comparison.setup.local_help')}</small>
                            </span>
                        </button>
                    </fieldset>
                ) : null}

                {routes.length === 0 ? (
                    <div className="model-setup-empty" role="status">
                        <Server size={22} />
                        <strong>{t('model_comparison.setup.no_exact_route')}</strong>
                        <span>{t('model_comparison.setup.no_exact_route_help')}</span>
                    </div>
                ) : (
                    <>
                        {routes.length > 1 ? (
                            <label className="model-setup-field">
                                <span>{t('model_comparison.setup.provider')}</span>
                                <select
                                    onChange={(event) => {
                                        onProviderChange(event.target.value);
                                    }}
                                    value={setup.providerId}
                                >
                                    {routes.map((candidate) => (
                                        <option
                                            key={candidate.provider}
                                            value={candidate.provider}
                                        >
                                            {candidate.provider_name}
                                            {candidate.provider_connected
                                                ? ` · ${t('model_comparison.setup.connected')}`
                                                : ''}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        ) : null}

                        {provider && setup.mode === 'remote' && !needsApiKey ? (
                            <div className="model-provider-state connected">
                                <CheckCircle2 size={18} />
                                <span>
                                    <strong>{t(
                                        'model_comparison.setup.credentials_ready',
                                    )}</strong>
                                    <small>{t(
                                        'model_comparison.setup.credentials_ready_help',
                                    )}</small>
                                </span>
                            </div>
                        ) : null}

                        {needsApiKey && provider ? (
                            <>
                                <label className="model-setup-field">
                                    <span>{t('model_comparison.setup.api_key', {
                                        provider: provider.name,
                                    })}</span>
                                    <input
                                        autoComplete="off"
                                        onChange={(event) => {
                                            onApiKeyChange(event.target.value);
                                        }}
                                        placeholder="sk-…"
                                        type="password"
                                        value={setup.apiKey}
                                    />
                                    <small>{t('model_comparison.setup.api_key_help')}</small>
                                </label>
                                <label className="model-setup-field">
                                    <span>{t('model_comparison.setup.base_url')}</span>
                                    <input
                                        onChange={(event) => {
                                            onBaseUrlChange(event.target.value);
                                        }}
                                        placeholder={provider.api || 'https://api.example.com/v1'}
                                        type="url"
                                        value={setup.baseUrl}
                                    />
                                    <small>{t('model_comparison.setup.base_url_help')}</small>
                                </label>
                            </>
                        ) : null}
                    </>
                )}

                {setup.error ? (
                    <div className="model-setup-error" role="alert">
                        {t(`model_comparison.errors.${setup.error}`)}
                    </div>
                ) : null}
            </div>

            <footer>
                <span>{route ? t('model_comparison.setup.router_help') : ''}</span>
                <div>
                    <button
                        className="btn-gnosi-secondary"
                        onClick={onCancel}
                        type="button"
                    >
                        {t('common.cancel')}
                    </button>
                    <button
                        className="btn-gnosi-primary"
                        disabled={
                            !provider
                            || !route
                            || (needsApiKey && !setup.apiKey.trim())
                            || busyModelId === setup.model.id
                        }
                        onClick={() => {
                            void onActivate();
                        }}
                        type="button"
                    >
                        {busyModelId === setup.model.id ? (
                            <Loader2 className="animate-spin" size={16} />
                        ) : null}
                        {t('model_comparison.setup.activate')}
                    </button>
                </div>
            </footer>
        </section>
    );
}

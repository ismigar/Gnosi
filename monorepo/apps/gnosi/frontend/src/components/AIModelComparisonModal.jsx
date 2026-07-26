import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, CheckCircle2,
    ChevronLeft, ChevronRight, Cloud, KeyRound, Loader2, RefreshCw, Search,
    Server, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    catalogModelToRegistryEntry,
    matchingRegistryIndexes,
    suggestedCatalogModel,
} from '../lib/modelComparisonRegistry';
import './AIModelComparisonModal.css';

const PROFILE_KEYS = ['worker', 'administrative', 'documentalist', 'allrounder', 'expert'];
const PROFILE_ICONS = {
    worker: '🟢',
    administrative: '🔵',
    documentalist: '📑',
    allrounder: '🟡',
    expert: '🟣',
};

const parseNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const formatMetric = (value, digits = 1) => (
    value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
);

const formatContext = (value) => {
    if (!value) return '—';
    if (value >= 1_000_000) return `${formatMetric(value / 1_000_000, 1)}M`;
    return `${formatMetric(value / 1000, 0)}K`;
};

export function AIModelComparisonModal({ isOpen, onClose }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [profile, setProfile] = useState('all');
    const [showProfileHelp, setShowProfileHelp] = useState(false);
    const [maxPrice, setMaxPrice] = useState('');
    const [minContext, setMinContext] = useState('');
    const [inputTokens, setInputTokens] = useState(5000000);
    const [outputTokens, setOutputTokens] = useState(1000000);
    const [sort, setSort] = useState({ key: 'intelligence', direction: 'desc' });
    const [feed, setFeed] = useState(null);
    const [loading, setLoading] = useState(false);
    const [errorCode, setErrorCode] = useState('');
    const [requestVersion, setRequestVersion] = useState(0);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [savingApiKey, setSavingApiKey] = useState(false);
    const [registry, setRegistry] = useState({ models: [], budget: {} });
    const [catalog, setCatalog] = useState(null);
    const [configurationLoading, setConfigurationLoading] = useState(false);
    const [configurationError, setConfigurationError] = useState('');
    const [setup, setSetup] = useState(null);
    const [busyModelId, setBusyModelId] = useState('');
    const [actionMessage, setActionMessage] = useState(null);
    const [fallbackNoticeDismissed, setFallbackNoticeDismissed] = useState(false);
    const bodyRef = React.useRef(null);
    const tableWrapRef = React.useRef(null);

    useEffect(() => {
        if (!isOpen) return undefined;
        const controller = new AbortController();
        setLoading(true);
        setErrorCode('');
        setFallbackNoticeDismissed(false);
        fetch('/api/ai/model-comparison', { signal: controller.signal })
            .then(async (response) => {
                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    const error = new Error('Artificial Analysis request failed');
                    error.code = payload?.detail?.code || 'upstream_error';
                    throw error;
                }
                setFeed(payload);
            })
            .catch((error) => {
                if (error.name !== 'AbortError') {
                    setFeed(null);
                    setErrorCode(error.code || 'network_error');
                }
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [isOpen, requestVersion]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const controller = new AbortController();
        setConfigurationLoading(true);
        setConfigurationError('');
        Promise.all([
            fetch('/api/ai/models', { signal: controller.signal }),
            fetch('/api/ai/model-catalog', { signal: controller.signal }),
        ])
            .then(async ([registryResponse, catalogResponse]) => {
                if (!registryResponse.ok || !catalogResponse.ok) {
                    throw new Error('Model configuration request failed');
                }
                const [registryPayload, catalogPayload] = await Promise.all([
                    registryResponse.json(),
                    catalogResponse.json(),
                ]);
                setRegistry({
                    models: registryPayload.models || [],
                    budget: registryPayload.budget || {},
                });
                setCatalog(catalogPayload);
            })
            .catch((error) => {
                if (error.name !== 'AbortError') setConfigurationError('configuration_load_error');
            })
            .finally(() => {
                if (!controller.signal.aborted) setConfigurationLoading(false);
            });
        return () => controller.abort();
    }, [isOpen, requestVersion]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                if (setup) setSetup(null);
                else onClose();
                return;
            }
            const targetTag = event.target?.tagName;
            if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(targetTag) || event.target?.isContentEditable) return;
            const body = bodyRef.current;
            if (!body) return;
            const distance = event.key === 'ArrowDown' ? 80
                : event.key === 'ArrowUp' ? -80
                    : event.key === 'PageDown' ? body.clientHeight * 0.85
                        : event.key === 'PageUp' ? -body.clientHeight * 0.85
                            : null;
            if (distance != null) {
                event.preventDefault();
                event.stopPropagation();
                body.scrollBy({ top: distance, behavior: 'smooth' });
            } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                event.stopPropagation();
                body.scrollTo({ top: event.key === 'Home' ? 0 : body.scrollHeight, behavior: 'smooth' });
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, onClose, setup]);

    const providersById = useMemo(() => Object.fromEntries(
        (catalog?.providers || []).map((provider) => [provider.id, provider]),
    ), [catalog]);

    const models = useMemo(() => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const priceLimit = maxPrice === '' ? Number.POSITIVE_INFINITY : parseNumber(maxPrice);
        const contextFloor = minContext === '' ? 0 : parseNumber(minContext) * 1000;
        return [...(feed?.models || [])]
            .filter((model) => (
                (!normalizedQuery || `${model.name} ${model.creator}`.toLocaleLowerCase().includes(normalizedQuery))
                && (profile === 'all' || model.profile === profile)
                && (maxPrice === '' || (model.input_price != null && model.input_price <= priceLimit))
                && (minContext === '' || (model.context_window != null && model.context_window >= contextFloor))
            ))
            .sort((a, b) => {
                const first = a[sort.key];
                const second = b[sort.key];
                if (first == null && second == null) return 0;
                if (first == null) return 1;
                if (second == null) return -1;
                const comparison = typeof first === 'string'
                    ? first.localeCompare(second)
                    : first - second;
                return sort.direction === 'asc' ? comparison : -comparison;
            });
    }, [feed, maxPrice, minContext, profile, query, sort]);

    if (!isOpen) return null;

    const changeSort = (key) => {
        setSort((current) => ({
            key,
            direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
        }));
    };
    const sortIcon = (key) => {
        if (sort.key !== key) return <ArrowUpDown size={14} />;
        return sort.direction === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    };
    const monthlyCost = (model) => {
        if (model.input_price == null || model.output_price == null) return null;
        return (
            (parseNumber(inputTokens) / 1000000) * model.input_price
            + (parseNumber(outputTokens) / 1000000) * model.output_price
        );
    };
    const columns = [
        ['name', 'model'],
        ['creator', 'creator'],
        ['intelligence', 'intelligence'],
        ['coding', 'coding'],
        ['agentic', 'agentic'],
        ['input_price', 'input_price'],
        ['output_price', 'output_price'],
        ['context_window', 'context'],
        ['speed', 'speed'],
        ['latency', 'latency'],
        ['profile', 'profile'],
    ];
    const saveApiKey = async () => {
        if (!apiKeyInput.trim()) return;
        setSavingApiKey(true);
        try {
            const response = await fetch('/api/ai/providers/artificial_analysis/credentials', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ api_key: apiKeyInput.trim(), base_url: '' }),
            });
            if (!response.ok) throw new Error('Credential save failed');
            setApiKeyInput('');
            setRequestVersion((value) => value + 1);
        } catch {
            setErrorCode('credential_save_error');
        } finally {
            setSavingApiKey(false);
        }
    };
    const scrollTable = (distance) => {
        tableWrapRef.current?.scrollBy({ left: distance, behavior: 'smooth' });
    };
    const setupProviders = (model, mode) => {
        const isLocal = mode === 'local';
        const routeProviders = new Set((model.routes || [])
            .filter((route) => Boolean(route.is_local) === isLocal)
            .map((route) => route.provider));
        return (catalog?.providers || [])
            .filter((provider) => (
                Boolean(provider.is_local) === isLocal
                && (provider.models || []).length
                && (!isLocal || provider.live || provider.configured)
            ))
            .sort((first, second) => {
                const firstRoute = routeProviders.has(first.id) ? 1 : 0;
                const secondRoute = routeProviders.has(second.id) ? 1 : 0;
                if (firstRoute !== secondRoute) return secondRoute - firstRoute;
                if (first.connected !== second.connected) return Number(second.connected) - Number(first.connected);
                return first.name.localeCompare(second.name);
            });
    };
    const setupForMode = (model, mode) => {
        const providers = setupProviders(model, mode);
        const routeProviderIds = (model.routes || [])
            .filter((route) => Boolean(route.is_local) === (mode === 'local'))
            .map((route) => route.provider);
        const creator = String(model.creator || '').toLocaleLowerCase();
        const provider = providers.find((item) => routeProviderIds.includes(item.id) && item.connected)
            || providers.find((item) => routeProviderIds.includes(item.id))
            || providers.find((item) => (
                item.id.toLocaleLowerCase() === creator
                || item.name.toLocaleLowerCase().includes(creator)
            ))
            || (mode === 'local' && providers.length === 1 ? providers[0] : null)
            || null;
        const suggested = suggestedCatalogModel(provider, model);
        return {
            model,
            mode,
            providerId: provider?.id || '',
            modelId: suggested?.id || '',
            apiKey: '',
            baseUrl: provider?.base_url || provider?.api || '',
            error: '',
        };
    };
    const beginActivation = (model) => {
        setActionMessage(null);
        setSetup(setupForMode(model, 'remote'));
    };
    const changeSetupMode = (mode) => {
        setSetup((current) => current ? setupForMode(current.model, mode) : current);
    };
    const changeSetupProvider = (providerId) => {
        setSetup((current) => {
            if (!current) return current;
            const provider = providersById[providerId];
            const suggested = suggestedCatalogModel(provider, current.model);
            return {
                ...current,
                providerId,
                modelId: suggested?.id || '',
                apiKey: '',
                baseUrl: provider?.base_url || provider?.api || '',
                error: '',
            };
        });
    };
    const saveRegistry = async (nextModels) => {
        const response = await fetch('/api/ai/models', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ models: nextModels, budget: registry.budget || {} }),
        });
        if (!response.ok) throw new Error('Registry save failed');
        setRegistry((current) => ({ ...current, models: nextModels }));
        window.dispatchEvent(new CustomEvent('gnosi-ai-models-changed', {
            detail: { source: 'model-comparison' },
        }));
    };
    const deactivateModel = async (model) => {
        const indexes = new Set(matchingRegistryIndexes(registry.models, model));
        if (!indexes.size) return;
        setBusyModelId(model.id);
        setActionMessage(null);
        try {
            const nextModels = registry.models.map((entry, index) => (
                indexes.has(index) ? { ...entry, enabled: false } : entry
            ));
            await saveRegistry(nextModels);
            setActionMessage({ type: 'success', key: 'model_disabled', model: model.name });
        } catch {
            setActionMessage({ type: 'error', key: 'configuration_save_error' });
        } finally {
            setBusyModelId('');
        }
    };
    const activateModel = async () => {
        if (!setup) return;
        const provider = providersById[setup.providerId];
        const selectedModel = (provider?.models || []).find((model) => model.id === setup.modelId);
        const needsApiKey = setup.mode === 'remote' && !provider?.has_api_key;
        if (!provider || !selectedModel || (needsApiKey && !setup.apiKey.trim())) return;
        setBusyModelId(setup.model.id);
        setSetup((current) => ({ ...current, error: '' }));
        try {
            if (needsApiKey) {
                const credentialResponse = await fetch(`/api/ai/providers/${encodeURIComponent(provider.id)}/credentials`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        api_key: setup.apiKey.trim(),
                        base_url: setup.baseUrl || provider.api || '',
                    }),
                });
                if (!credentialResponse.ok) throw new Error('Credential save failed');
            }
            if (!provider.enabled || !provider.connected) {
                const statusResponse = await fetch(`/api/ai/providers/${encodeURIComponent(provider.id)}/status`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: true }),
                });
                if (!statusResponse.ok) throw new Error('Provider enable failed');
            }

            const existingIndex = registry.models.findIndex((entry) => (
                entry.provider === provider.id && entry.model_id === selectedModel.id
            ));
            const newEntry = catalogModelToRegistryEntry(provider, selectedModel);
            const nextModels = existingIndex >= 0
                ? registry.models.map((entry, index) => (
                    index === existingIndex ? { ...entry, ...newEntry, enabled: true } : entry
                ))
                : [...registry.models, newEntry];
            await saveRegistry(nextModels);
            setCatalog((current) => ({
                ...current,
                providers: (current?.providers || []).map((item) => (
                    item.id === provider.id
                        ? { ...item, connected: true, enabled: true, has_api_key: item.has_api_key || needsApiKey }
                        : item
                )),
            }));
            setActionMessage({
                type: 'success',
                key: 'model_enabled',
                model: setup.model.name,
                provider: provider.name,
            });
            setSetup(null);
        } catch {
            setSetup((current) => current ? { ...current, error: 'configuration_save_error' } : current);
        } finally {
            setBusyModelId('');
        }
    };

    const activeSetupProvider = setup ? providersById[setup.providerId] : null;
    const activeSetupProviders = setup ? setupProviders(setup.model, setup.mode) : [];
    const activeSetupModels = activeSetupProvider?.models || [];
    const setupNeedsApiKey = setup?.mode === 'remote' && activeSetupProvider && !activeSetupProvider.has_api_key;

    return (
        <div className="model-comparison-layer" role="presentation">
            <div className="model-comparison-backdrop" />
            <section className="model-comparison-modal" role="dialog" aria-modal="true" aria-labelledby="model-comparison-title">
                <header className="model-comparison-header">
                    <div>
                        <h2 id="model-comparison-title">{t('model_comparison.title')}</h2>
                    </div>
                    <button type="button" className="gnosi-close-btn" onClick={onClose} aria-label={t('model_comparison.close')}>
                        <X />
                    </button>
                </header>

                <div className="model-comparison-body" ref={bodyRef} tabIndex={0} aria-label={t('model_comparison.keyboard_scroll_hint')}>
                    {loading && (
                        <div className="model-comparison-status" role="status">
                            <Loader2 className="animate-spin" size={28} />
                            <strong>{t('model_comparison.loading')}</strong>
                            <span>{t('model_comparison.loading_description')}</span>
                        </div>
                    )}

                    {!loading && errorCode && (
                        <div className="model-comparison-status error" role="alert">
                            <strong>{t(`model_comparison.errors.${errorCode}`, t('model_comparison.errors.upstream_error'))}</strong>
                            <span>{t('model_comparison.errors.help')}</span>
                            <a className="model-comparison-api-link" href="https://artificialanalysis.ai/data-api" target="_blank" rel="noreferrer">
                                {t('model_comparison.get_api_key')} ↗
                            </a>
                            {(errorCode === 'api_key_missing' || errorCode === 'api_key_invalid' || errorCode === 'credential_save_error') && (
                                <div className="model-comparison-key-form">
                                    <label>
                                        <span>{t('model_comparison.api_key_label')}</span>
                                        <input
                                            type="password"
                                            value={apiKeyInput}
                                            onChange={(event) => setApiKeyInput(event.target.value)}
                                            placeholder={t('model_comparison.api_key_placeholder')}
                                            autoComplete="off"
                                        />
                                    </label>
                                    <button
                                        type="button"
                                        className="btn-gnosi-primary"
                                        disabled={!apiKeyInput.trim() || savingApiKey}
                                        onClick={saveApiKey}
                                    >
                                        {savingApiKey ? <Loader2 className="animate-spin" size={17} /> : null}
                                        {t('model_comparison.save_and_load')}
                                    </button>
                                </div>
                            )}
                            <button type="button" className="btn-gnosi-primary" onClick={() => setRequestVersion((value) => value + 1)}>
                                <RefreshCw size={17} />
                                {t('model_comparison.retry')}
                            </button>
                        </div>
                    )}

                    {!loading && feed && (
                        <>
                            <div className="model-comparison-meta">
                                <strong>{t('model_comparison.model_count', { count: feed.count })}</strong>
                                <span>{t('model_comparison.updated_at', {
                                    date: new Date(feed.fetched_at).toLocaleString(),
                                })}</span>
                                {feed.intelligence_index_version && (
                                    <span>{t('model_comparison.index_version', { version: feed.intelligence_index_version })}</span>
                                )}
                            </div>

                            {feed.fallback && !fallbackNoticeDismissed && (
                                <div className="model-configuration-banner warning" role="status">
                                    <span>{t(feed.stale
                                        ? 'model_comparison.cached_fallback'
                                        : 'model_comparison.catalog_fallback_active', { source: feed.source })}</span>
                                    <button type="button" onClick={() => setFallbackNoticeDismissed(true)} aria-label={t('model_comparison.close')}><X size={15} /></button>
                                </div>
                            )}

                            {configurationError && (
                                <div className="model-configuration-banner error" role="alert">
                                    {t(`model_comparison.errors.${configurationError}`)}
                                </div>
                            )}
                            {actionMessage && (
                                <div className={`model-configuration-banner ${actionMessage.type}`} role="status">
                                    {actionMessage.type === 'success' && <CheckCircle2 size={16} />}
                                    {t(`model_comparison.${actionMessage.key}`, {
                                        model: actionMessage.model,
                                        provider: actionMessage.provider,
                                    })}
                                </div>
                            )}

                            <div className="model-comparison-toolbar">
                                <label className="model-search">
                                    <Search size={18} />
                                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('model_comparison.search')} />
                                </label>
                                <label className="model-profile-filter">
                                    <span>{t('model_comparison.profile')} <button type="button" className="model-profile-help" onClick={() => setShowProfileHelp(true)} aria-label={t('model_comparison.profile_help_open')}>?</button></span>
                                    <select value={profile} onChange={(event) => setProfile(event.target.value)}>
                                        <option value="all">{t('model_comparison.all_profiles')}</option>
                                        {PROFILE_KEYS.map((key) => <option key={key} value={key}>{t(`model_comparison.profiles.${key}`)}</option>)}
                                    </select>
                                </label>
                                <label>
                                    <span>{t('model_comparison.max_price')}</span>
                                    <input type="number" min="0" step="0.01" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="1.00" />
                                </label>
                                <label>
                                    <span>{t('model_comparison.min_context')}</span>
                                    <input type="number" min="0" value={minContext} onChange={(event) => setMinContext(event.target.value)} placeholder="100" />
                                </label>
                            </div>

                            {showProfileHelp && (
                                <div className="model-profile-help-backdrop" role="presentation" onClick={() => setShowProfileHelp(false)}>
                                    <section className="model-profile-help-dialog" role="dialog" aria-modal="true" aria-labelledby="model-profile-help-title" onClick={(event) => event.stopPropagation()}>
                                        <header><div><h2 id="model-profile-help-title">{t('model_comparison.profile_help_title')}</h2><p>{t('model_comparison.profile_help_intro')}</p></div><button type="button" onClick={() => setShowProfileHelp(false)} aria-label={t('model_comparison.close')}><X size={20} /></button></header>
                                        <div className="model-profile-help-content">
                                            {PROFILE_KEYS.map((key) => <article key={key}><h3>{PROFILE_ICONS[key]} {t(`model_comparison.profiles.${key}`)}</h3><p><strong>{t(`model_comparison.profile_help.${key}.objective`)}</strong></p><p>{t(`model_comparison.profile_help.${key}.examples`)}</p></article>)}
                                            <article><h3>{t('model_comparison.profile_help_flow_title')}</h3><p>{t('model_comparison.profile_help_flow')}</p></article>
                                        </div>
                                    </section>
                                </div>
                            )}

                            <div className="model-cost-calculator">
                                <label><span>{t('model_comparison.input_tokens')}</span><input type="number" min="0" value={inputTokens} onChange={(event) => setInputTokens(event.target.value)} /></label>
                                <label><span>{t('model_comparison.output_tokens')}</span><input type="number" min="0" value={outputTokens} onChange={(event) => setOutputTokens(event.target.value)} /></label>
                            </div>

                            <div className="model-table-controls" aria-label={t('model_comparison.table_navigation')}>
                                <span><ArrowLeftRight size={16} /> {t('model_comparison.table_scroll_hint')} · {t('model_comparison.keyboard_scroll_hint')}</span>
                                <div>
                                    <button type="button" onClick={() => scrollTable(-640)} aria-label={t('model_comparison.scroll_left')}>
                                        <ChevronLeft size={17} />
                                    </button>
                                    <button type="button" onClick={() => scrollTable(640)} aria-label={t('model_comparison.scroll_right')}>
                                        <ChevronRight size={17} />
                                    </button>
                                </div>
                            </div>
                            <div className="model-table-wrap" ref={tableWrapRef}>
                                <table className="model-comparison-table">
                                    <thead><tr>
                                        {columns.map(([key, label]) => (
                                            <th key={key} className={key === 'name' ? 'model-comparison-sticky-start' : ''}><button type="button" onClick={() => changeSort(key)}>{t(`model_comparison.columns.${label}`)} {sortIcon(key)}</button></th>
                                        ))}
                                        <th>{t('model_comparison.columns.monthly_cost')}</th>
                                        <th className="model-comparison-sticky-end">{t('model_comparison.columns.available')}</th>
                                    </tr></thead>
                                    <tbody>
                                        {models.map((model) => {
                                            const cost = monthlyCost(model);
                                            const matchingIndexes = matchingRegistryIndexes(registry.models, model);
                                            const activeEntries = matchingIndexes
                                                .map((index) => registry.models[index])
                                                .filter((entry) => entry.enabled !== false);
                                            const isActive = activeEntries.length > 0;
                                            const routeLabel = activeEntries
                                                .map((entry) => providersById[entry.provider]?.name || entry.provider)
                                                .filter(Boolean)
                                                .join(', ');
                                            const isBusy = busyModelId === model.id;
                                            return (
                                                <tr key={model.id}>
                                                    <td className="model-comparison-sticky-start"><strong>{model.name}</strong><small>{model.release_date || '—'}</small></td>
                                                    <td>{model.creator || '—'}</td>
                                                    <td>{formatMetric(model.intelligence)}</td>
                                                    <td>{formatMetric(model.coding)}</td>
                                                    <td>{formatMetric(model.agentic)}</td>
                                                    <td>{model.input_price == null ? '—' : `$${formatMetric(model.input_price, 3)}`}</td>
                                                    <td>{model.output_price == null ? '—' : `$${formatMetric(model.output_price, 3)}`}</td>
                                                    <td>{formatContext(model.context_window)}</td>
                                                    <td>{model.speed == null ? '—' : `${formatMetric(model.speed)} t/s`}</td>
                                                    <td>{model.latency == null ? '—' : `${formatMetric(model.latency, 2)} s`}</td>
                                                    <td><span className={`model-profile-badge ${model.profile}`}>{PROFILE_ICONS[model.profile]} {t(`model_comparison.profiles.${model.profile}`)}</span></td>
                                                    <td><strong>{cost == null ? '—' : `$${formatMetric(cost, 2)}`}</strong></td>
                                                    <td className="model-comparison-sticky-end">
                                                        <div className="model-availability-cell">
                                                            <button
                                                                type="button"
                                                                role="switch"
                                                                aria-checked={isActive}
                                                                aria-label={t(
                                                                    isActive
                                                                        ? 'model_comparison.disable_model'
                                                                        : 'model_comparison.enable_model',
                                                                    { model: model.name },
                                                                )}
                                                                className={`model-availability-toggle ${isActive ? 'active' : ''}`}
                                                                disabled={configurationLoading || Boolean(configurationError) || isBusy}
                                                                onClick={() => (isActive ? deactivateModel(model) : beginActivation(model))}
                                                            >
                                                                {isBusy ? <Loader2 className="animate-spin" size={15} /> : <span />}
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
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {models.length === 0 && <div className="model-comparison-empty">{t('model_comparison.no_results')}</div>}
                            </div>
                            <p className="model-comparison-note">
                                {t('model_comparison.data_note')}{' '}
                                <a href={feed.source_url} target="_blank" rel="noreferrer">Artificial Analysis ↗</a>
                            </p>
                        </>
                    )}
                </div>
            </section>
            {setup && (
                <div className="model-setup-layer" role="presentation">
                    <button
                        type="button"
                        className="model-setup-backdrop"
                        aria-label={t('common.cancel')}
                        onClick={() => setSetup(null)}
                    />
                    <section className="model-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="model-setup-title">
                        <header>
                            <div>
                                <p>{t('model_comparison.setup.eyebrow')}</p>
                                <h3 id="model-setup-title">{setup.model.name}</h3>
                                <span>{t('model_comparison.setup.subtitle')}</span>
                            </div>
                            <button type="button" className="gnosi-close-btn" onClick={() => setSetup(null)} aria-label={t('common.cancel')}>
                                <X />
                            </button>
                        </header>

                        <div className="model-setup-content">
                            <fieldset className="model-execution-choice">
                                <legend>{t('model_comparison.setup.execution')}</legend>
                                <button
                                    type="button"
                                    className={setup.mode === 'remote' ? 'active' : ''}
                                    onClick={() => changeSetupMode('remote')}
                                >
                                    <Cloud size={20} />
                                    <span><strong>{t('model_comparison.setup.remote')}</strong><small>{t('model_comparison.setup.remote_help')}</small></span>
                                </button>
                                <button
                                    type="button"
                                    className={setup.mode === 'local' ? 'active' : ''}
                                    onClick={() => changeSetupMode('local')}
                                >
                                    <Server size={20} />
                                    <span><strong>{t('model_comparison.setup.local')}</strong><small>{t('model_comparison.setup.local_help')}</small></span>
                                </button>
                            </fieldset>

                            {activeSetupProviders.length === 0 ? (
                                <div className="model-setup-empty" role="status">
                                    <Server size={22} />
                                    <strong>{t('model_comparison.setup.no_local_models')}</strong>
                                    <span>{t('model_comparison.setup.no_local_models_help')}</span>
                                </div>
                            ) : (
                                <>
                                    <label className="model-setup-field">
                                        <span>{t('model_comparison.setup.provider')}</span>
                                        <select value={setup.providerId} onChange={(event) => changeSetupProvider(event.target.value)}>
                                            <option value="">{t('model_comparison.setup.choose_provider')}</option>
                                            {activeSetupProviders.map((provider) => (
                                                <option key={provider.id} value={provider.id}>
                                                    {provider.name}{provider.connected ? ` · ${t('model_comparison.setup.connected')}` : ''}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className="model-setup-field">
                                        <span>{t('model_comparison.setup.model_route')}</span>
                                        <select
                                            value={setup.modelId}
                                            disabled={!activeSetupProvider}
                                            onChange={(event) => setSetup((current) => ({ ...current, modelId: event.target.value, error: '' }))}
                                        >
                                            <option value="">{t('model_comparison.setup.choose_model')}</option>
                                            {activeSetupModels.map((model) => (
                                                <option key={model.id} value={model.id}>{model.name} · {model.id}</option>
                                            ))}
                                        </select>
                                        {activeSetupProvider && !setup.modelId && (
                                            <small>{t('model_comparison.setup.confirm_route_help')}</small>
                                        )}
                                    </label>

                                    {activeSetupProvider && setup.mode === 'remote' && (
                                        <div className={`model-provider-state ${setupNeedsApiKey ? 'needs-key' : 'connected'}`}>
                                            {setupNeedsApiKey ? <KeyRound size={18} /> : <CheckCircle2 size={18} />}
                                            <span>
                                                <strong>
                                                    {setupNeedsApiKey
                                                        ? t('model_comparison.setup.key_required')
                                                        : t('model_comparison.setup.credentials_ready')}
                                                </strong>
                                                <small>
                                                    {setupNeedsApiKey
                                                        ? t('model_comparison.setup.key_required_help')
                                                        : t('model_comparison.setup.credentials_ready_help')}
                                                </small>
                                            </span>
                                        </div>
                                    )}

                                    {setupNeedsApiKey && (
                                        <label className="model-setup-field">
                                            <span>{t('model_comparison.setup.api_key', { provider: activeSetupProvider.name })}</span>
                                            <input
                                                type="password"
                                                value={setup.apiKey}
                                                autoComplete="off"
                                                placeholder="sk-…"
                                                onChange={(event) => setSetup((current) => ({ ...current, apiKey: event.target.value, error: '' }))}
                                            />
                                            <small>{t('model_comparison.setup.api_key_help')}</small>
                                        </label>
                                    )}

                                    {setupNeedsApiKey && (
                                        <label className="model-setup-field">
                                            <span>{t('model_comparison.setup.base_url')}</span>
                                            <input
                                                type="url"
                                                value={setup.baseUrl}
                                                placeholder={activeSetupProvider.api || 'https://api.example.com/v1'}
                                                onChange={(event) => setSetup((current) => ({ ...current, baseUrl: event.target.value, error: '' }))}
                                            />
                                            <small>{t('model_comparison.setup.base_url_help')}</small>
                                        </label>
                                    )}
                                </>
                            )}

                            {setup.error && (
                                <div className="model-setup-error" role="alert">
                                    {t(`model_comparison.errors.${setup.error}`)}
                                </div>
                            )}
                        </div>

                        <footer>
                            <span>{t('model_comparison.setup.router_help')}</span>
                            <div>
                                <button type="button" className="btn-gnosi-secondary" onClick={() => setSetup(null)}>
                                    {t('common.cancel')}
                                </button>
                                <button
                                    type="button"
                                    className="btn-gnosi-primary"
                                    disabled={
                                        !activeSetupProvider
                                        || !setup.modelId
                                        || (setupNeedsApiKey && !setup.apiKey.trim())
                                        || busyModelId === setup.model.id
                                    }
                                    onClick={activateModel}
                                >
                                    {busyModelId === setup.model.id && <Loader2 className="animate-spin" size={16} />}
                                    {t('model_comparison.setup.activate')}
                                </button>
                            </div>
                        </footer>
                    </section>
                </div>
            )}
        </div>
    );
}

export default AIModelComparisonModal;

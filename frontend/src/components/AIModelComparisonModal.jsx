import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, CheckCircle2,
    ChevronDown, Cloud, Loader2, RefreshCw, Search,
    Server, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    comparisonRoutesForMode,
    comparisonRouteToRegistryEntry,
    matchingRegistryIndexes,
} from '../lib/modelComparisonRegistry';
import './AIModelComparisonModal.css';

const PROFILE_KEYS = ['worker', 'administrative', 'documentalist', 'allrounder', 'expert', 'unrated'];
const MODE_KEYS = ['text', 'image', 'audio', 'video'];
const PROFILE_ICONS = {
    worker: '🟢',
    administrative: '🔵',
    documentalist: '📑',
    allrounder: '🟡',
    expert: '🟣',
    unrated: '⚪',
};

const parseNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const isFiniteMetric = (value) => value != null
    && Number.isFinite(Number(value))
    && Number(value) >= 0;

const formatMetric = (value, digits = 1) => (
    isFiniteMetric(value)
        ? Number(value).toLocaleString(undefined, { maximumFractionDigits: digits })
        : '—'
);

const formatContext = (value) => {
    if (!isFiniteMetric(value)) return '—';
    if (value >= 1_000_000) return `${formatMetric(value / 1_000_000, 1)}M`;
    return `${formatMetric(value / 1000, 0)}K`;
};

export function AIModelComparisonModal({ isOpen, onClose }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [profile, setProfile] = useState('all');
    const [availability, setAvailability] = useState('all');
    const [modes, setModes] = useState([]);
    const [modesMenuOpen, setModesMenuOpen] = useState(false);
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
    const [tableScrollWidth, setTableScrollWidth] = useState(0);
    const [tableViewportWidth, setTableViewportWidth] = useState(0);
    const bodyRef = React.useRef(null);
    const tableWrapRef = React.useRef(null);
    const scrollbarRef = React.useRef(null);

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
        if (!isOpen || !feed || !tableWrapRef.current) return undefined;
        const tableWrap = tableWrapRef.current;
        const table = tableWrap.querySelector('.model-comparison-table');
        if (!table) return undefined;
        const updateWidth = () => {
            setTableScrollWidth(table.scrollWidth);
            setTableViewportWidth(tableWrap.clientWidth);
        };
        updateWidth();
        const observer = new ResizeObserver(updateWidth);
        observer.observe(table);
        observer.observe(tableWrap);
        return () => observer.disconnect();
    }, [feed, isOpen]);

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
                    models: registryPayload.configured_models || [],
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
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                const scrollbar = scrollbarRef.current;
                if (!scrollbar) return;
                event.preventDefault();
                event.stopPropagation();
                scrollbar.scrollBy({
                    left: event.key === 'ArrowLeft' ? -80 : 80,
                    behavior: 'smooth',
                });
                return;
            }
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
        // Defensive dedup: a stale 24h cache may still hold duplicate rows until
        // it refreshes. Keep the first occurrence, keyed by id/slug/name.
        const deduped = [...(feed?.models || [])].reduce((acc, model) => {
            const key = model.id || model.slug || model.name;
            if (!key) {
                acc.set(Symbol(), model);
            } else if (!acc.has(key)) {
                acc.set(key, model);
            }
            return acc;
        }, new Map());
        return Array.from(deduped.values())
            .filter((model) => (
                (!normalizedQuery || `${model.name} ${model.creator}`.toLocaleLowerCase().includes(normalizedQuery))
                && (profile === 'all' || model.profile === profile)
                && (!modes.length || modes.some((mode) => (model.modes || ['text']).includes(mode)))
                && (
                    availability === 'all'
                    || matchingRegistryIndexes(registry.models, model)
                        .some((index) => registry.models[index]?.enabled !== false) === (availability === 'active')
                )
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
    }, [availability, feed, maxPrice, minContext, modes, profile, query, registry.models, sort]);

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
        if (!isFiniteMetric(model.input_price) || !isFiniteMetric(model.output_price)) return null;
        return (
            (parseNumber(inputTokens) / 1000000) * model.input_price
            + (parseNumber(outputTokens) / 1000000) * model.output_price
        );
    };
    const metricSourceTitle = (model, field) => {
        const source = model.metric_sources?.[field];
        return source ? t(`model_comparison.metric_sources.${source}`) : undefined;
    };
    // Discrete inline marker for values filled from the 24h cache, so stale
    // metrics are visible without hovering. Non-cached metrics render nothing.
    const cachedMarker = (model, field) => {
        if (model.metric_sources?.[field] !== 'artificial_analysis_cache') return null;
        const title = t('model_comparison.metric_sources.artificial_analysis_cache');
        return <span className="metric-cached-marker" title={title} aria-label={title}>·</span>;
    };
    const feedModels = feed?.models || [];
    const metricAvailability = {
        intelligence: feedModels.some((model) => model.intelligence != null),
        coding: feedModels.some((model) => model.coding != null),
        agentic: feedModels.some((model) => model.agentic != null),
        speed: feedModels.some((model) => model.speed != null),
        latency: feedModels.some((model) => model.latency != null),
        profile: feedModels.some((model) => model.profile && model.profile !== 'unrated'),
    };
    const columns = [
        ['name', 'model'],
        ['creator', 'creator'],
        ['modes', 'modes'],
        ...(metricAvailability.intelligence ? [['intelligence', 'intelligence']] : []),
        ...(metricAvailability.coding ? [['coding', 'coding']] : []),
        ...(metricAvailability.agentic ? [['agentic', 'agentic']] : []),
        ['input_price', 'input_price'],
        ['output_price', 'output_price'],
        ['context_window', 'context'],
        ...(metricAvailability.speed ? [['speed', 'speed']] : []),
        ...(metricAvailability.latency ? [['latency', 'latency']] : []),
        ...(metricAvailability.profile ? [['profile', 'profile']] : []),
    ];
    const tableMinWidth = Math.max(1050, 380 + ((columns.length - 1) * 125));
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
    const setupRoutes = (model, mode) => comparisonRoutesForMode(
        model,
        catalog?.providers || [],
        mode,
    );
    const setupForMode = (model, mode) => {
        const routes = setupRoutes(model, mode);
        const creator = String(model.creator || '').toLocaleLowerCase();
        const route = routes.find((item) => item.provider_connected)
            || routes.find((item) => (
                item.provider.toLocaleLowerCase() === creator
                || item.provider_name.toLocaleLowerCase().includes(creator)
            ))
            || routes[0]
            || null;
        const provider = route ? providersById[route.provider] : null;
        return {
            model,
            mode,
            providerId: route?.provider || '',
            apiKey: '',
            baseUrl: provider?.base_url || provider?.api || '',
            error: '',
        };
    };
    const beginActivation = (model) => {
        setActionMessage(null);
        const mode = setupRoutes(model, 'remote').length > 0
            ? 'remote'
            : setupRoutes(model, 'local').length > 0
                ? 'local'
                : 'remote';
        setSetup(setupForMode(model, mode));
    };
    const changeSetupMode = (mode) => {
        setSetup((current) => current ? setupForMode(current.model, mode) : current);
    };
    const changeSetupProvider = (providerId) => {
        setSetup((current) => {
            if (!current) return current;
            const provider = providersById[providerId];
            return {
                ...current,
                providerId,
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
        const selectedRoute = setupRoutes(setup.model, setup.mode)
            .find((route) => route.provider === setup.providerId);
        const needsApiKey = setup.mode === 'remote' && !provider?.has_api_key;
        if (!provider || !selectedRoute || (needsApiKey && !setup.apiKey.trim())) return;
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
                entry.provider === provider.id && entry.model_id === selectedRoute.model_id
            ));
            const newEntry = comparisonRouteToRegistryEntry(selectedRoute);
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
    const activeSetupRoutes = setup ? setupRoutes(setup.model, setup.mode) : [];
    const activeSetupRoute = activeSetupRoutes.find((route) => route.provider === setup?.providerId) || null;
    const activeSetupModes = setup
        ? ['remote', 'local'].filter((mode) => setupRoutes(setup.model, mode).length > 0)
        : [];
    const setupNeedsApiKey = setup?.mode === 'remote' && activeSetupProvider && !activeSetupProvider.has_api_key;
    const setupPanel = setup && (
        <section
            className="model-setup-dialog model-setup-inline"
            aria-label={t('model_comparison.setup.activate')}
            style={tableViewportWidth ? { width: `${tableViewportWidth}px` } : undefined}
        >
            <div className="model-setup-content">
                {activeSetupModes.length > 1 && (
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
                )}

                {activeSetupRoutes.length === 0 ? (
                    <div className="model-setup-empty" role="status">
                        <Server size={22} />
                        <strong>{t('model_comparison.setup.no_exact_route')}</strong>
                        <span>{t('model_comparison.setup.no_exact_route_help')}</span>
                    </div>
                ) : (
                    <>
                        {activeSetupRoutes.length > 1 && (
                            <label className="model-setup-field">
                                <span>{t('model_comparison.setup.provider')}</span>
                                <select value={setup.providerId} onChange={(event) => changeSetupProvider(event.target.value)}>
                                    {activeSetupRoutes.map((route) => (
                                        <option key={route.provider} value={route.provider}>
                                            {route.provider_name}{route.provider_connected ? ` · ${t('model_comparison.setup.connected')}` : ''}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}

                        {activeSetupProvider && setup.mode === 'remote' && !setupNeedsApiKey && (
                            <div className="model-provider-state connected">
                                <CheckCircle2 size={18} />
                                <span>
                                    <strong>{t('model_comparison.setup.credentials_ready')}</strong>
                                    <small>{t('model_comparison.setup.credentials_ready_help')}</small>
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
                <span>{activeSetupRoute ? t('model_comparison.setup.router_help') : ''}</span>
                <div>
                    <button type="button" className="btn-gnosi-secondary" onClick={() => setSetup(null)}>
                        {t('common.cancel')}
                    </button>
                    <button
                        type="button"
                        className="btn-gnosi-primary"
                        disabled={
                            !activeSetupProvider
                            || !activeSetupRoute
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
    );

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
                                    <span>{t(
                                        feed.stale
                                            ? 'model_comparison.cached_fallback'
                                            : feed.retry_at
                                                ? 'model_comparison.catalog_fallback_no_cache_until'
                                                : 'model_comparison.catalog_fallback_no_cache',
                                        {
                                            source: feed.source,
                                            date: feed.retry_at
                                                ? new Date(feed.retry_at).toLocaleString()
                                                : '',
                                        },
                                    )}</span>
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
                                {metricAvailability.profile && (
                                    <label className="model-profile-filter">
                                        <span>{t('model_comparison.profile')} <button type="button" className="model-profile-help" onMouseEnter={() => setShowProfileHelp(true)} onClick={() => setShowProfileHelp(true)} aria-label={t('model_comparison.profile_help_open')}>?</button></span>
                                        <select value={profile} onChange={(event) => setProfile(event.target.value)}>
                                            <option value="all">{t('model_comparison.all_profiles')}</option>
                                            {PROFILE_KEYS.map((key) => <option key={key} value={key}>{t(`model_comparison.profiles.${key}`)}</option>)}
                                        </select>
                                    </label>
                                )}
                                <label>
                                    <span>{t('model_comparison.availability')}</span>
                                    <select value={availability} onChange={(event) => setAvailability(event.target.value)}>
                                        <option value="all">{t('model_comparison.all_availability')}</option>
                                        <option value="active">{t('model_comparison.active')}</option>
                                        <option value="inactive">{t('model_comparison.inactive')}</option>
                                    </select>
                                </label>
                                <div className="model-modes-filter">
                                    <span>{t('model_comparison.modes')}</span>
                                    <button
                                        type="button"
                                        aria-expanded={modesMenuOpen}
                                        aria-haspopup="menu"
                                        onClick={() => setModesMenuOpen((current) => !current)}
                                    >
                                        <span>{modes.length
                                            ? modes.map((mode) => t(`model_comparison.modes_list.${mode}`)).join(', ')
                                            : t('model_comparison.all_modes')}</span>
                                        <ChevronDown size={16} />
                                    </button>
                                    {modesMenuOpen && <div className="model-modes-menu" role="menu">
                                        {MODE_KEYS.map((mode) => (
                                            <label key={mode}>
                                                <input
                                                    type="checkbox"
                                                    checked={modes.includes(mode)}
                                                    onChange={() => setModes((current) => (
                                                        current.includes(mode)
                                                            ? current.filter((item) => item !== mode)
                                                            : [...current, mode]
                                                    ))}
                                                />
                                                {t(`model_comparison.modes_list.${mode}`)}
                                            </label>
                                        ))}
                                    </div>}
                                </div>
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
                                <div className="model-profile-help-backdrop" role="presentation" onMouseLeave={() => setShowProfileHelp(false)} onClick={() => setShowProfileHelp(false)}>
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
                            </div>
                            <div className="model-table-wrap" ref={tableWrapRef}>
                                <table className="model-comparison-table" style={{ minWidth: `${tableMinWidth}px` }}>
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
                                                <React.Fragment key={model.id}>
                                                    <tr>
                                                        <td className="model-comparison-sticky-start"><strong>{model.name}</strong><small>{model.release_date || '—'}</small></td>
                                                        <td>{model.creator || '—'}</td>
                                                        <td>
                                                            <div className="model-mode-list">
                                                                {(model.modes || ['text']).map((mode) => (
                                                                    <span key={mode}>{t(`model_comparison.modes_list.${mode}`)}</span>
                                                                ))}
                                                            </div>
                                                        </td>
                                                        {metricAvailability.intelligence && <td title={metricSourceTitle(model, 'intelligence')}>{formatMetric(model.intelligence)}{cachedMarker(model, 'intelligence')}</td>}
                                                        {metricAvailability.coding && <td title={metricSourceTitle(model, 'coding')}>{formatMetric(model.coding)}{cachedMarker(model, 'coding')}</td>}
                                                        {metricAvailability.agentic && <td title={metricSourceTitle(model, 'agentic')}>{formatMetric(model.agentic)}{cachedMarker(model, 'agentic')}</td>}
                                                        <td title={metricSourceTitle(model, 'input_price')}>{model.input_price == null ? '—' : `$${formatMetric(model.input_price, 3)}`}{cachedMarker(model, 'input_price')}</td>
                                                        <td title={metricSourceTitle(model, 'output_price')}>{model.output_price == null ? '—' : `$${formatMetric(model.output_price, 3)}`}{cachedMarker(model, 'output_price')}</td>
                                                        <td title={metricSourceTitle(model, 'context_window')}>{formatContext(model.context_window)}{cachedMarker(model, 'context_window')}</td>
                                                        {metricAvailability.speed && <td title={metricSourceTitle(model, 'speed')}>{isFiniteMetric(model.speed) ? `${formatMetric(model.speed)} t/s` : '—'}{cachedMarker(model, 'speed')}</td>}
                                                        {metricAvailability.latency && <td title={metricSourceTitle(model, 'latency')}>{isFiniteMetric(model.latency) ? `${formatMetric(model.latency, 2)} s` : '—'}{cachedMarker(model, 'latency')}</td>}
                                                        {metricAvailability.profile && <td><span className={`model-profile-badge ${model.profile}`}>{PROFILE_ICONS[model.profile]} {t(`model_comparison.profiles.${model.profile}`)}</span></td>}
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
                                                    {setup?.model.id === model.id && (
                                                        <tr className="model-setup-row">
                                                            <td className="model-setup-cell" colSpan={columns.length + 2}>{setupPanel}</td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {models.length === 0 && <div className="model-comparison-empty">{t('model_comparison.no_results')}</div>}
                            </div>
                            <div className="model-table-scrollbar" ref={scrollbarRef} aria-label={t('model_comparison.table_scroll_hint')} onScroll={(event) => {
                                tableWrapRef.current?.style.setProperty('--model-table-scroll-left', `${event.currentTarget.scrollLeft}px`);
                            }}>
                                <div style={{ width: `${Math.max(tableScrollWidth, 1)}px`, height: '1px' }} />
                            </div>
                            <p className="model-comparison-note">
                                {t('model_comparison.data_note')}{' '}
                                <a href={feed.source_url} target="_blank" rel="noreferrer">Artificial Analysis ↗</a>
                            </p>
                        </>
                    )}
                </div>
            </section>
        </div>
    );
}

export default AIModelComparisonModal;

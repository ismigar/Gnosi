import React, { useEffect, useMemo, useState } from 'react';
import {
    ArrowDown, ArrowUp, ArrowUpDown, Calculator, Loader2, RefreshCw, Search, X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
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

    useEffect(() => {
        if (!isOpen) return undefined;
        const controller = new AbortController();
        setLoading(true);
        setErrorCode('');
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
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen, onClose]);

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

    return (
        <div className="model-comparison-layer" role="presentation">
            <div className="model-comparison-backdrop" />
            <section className="model-comparison-modal" role="dialog" aria-modal="true" aria-labelledby="model-comparison-title">
                <header className="model-comparison-header">
                    <div>
                        <p>{t('model_comparison.eyebrow')}</p>
                        <h2 id="model-comparison-title">{t('model_comparison.title')}</h2>
                        <span>{t('model_comparison.subtitle')}</span>
                    </div>
                    <button type="button" className="gnosi-close-btn" onClick={onClose} aria-label={t('model_comparison.close')}>
                        <X />
                    </button>
                </header>

                <div className="model-comparison-body">
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

                            <div className="model-comparison-toolbar">
                                <label className="model-search">
                                    <Search size={18} />
                                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('model_comparison.search')} />
                                </label>
                                <label>
                                    <span>{t('model_comparison.profile')}</span>
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

                            <div className="model-cost-calculator">
                                <div className="model-cost-title"><Calculator size={19} /><strong>{t('model_comparison.calculator')}</strong></div>
                                <label><span>{t('model_comparison.input_tokens')}</span><input type="number" min="0" value={inputTokens} onChange={(event) => setInputTokens(event.target.value)} /></label>
                                <label><span>{t('model_comparison.output_tokens')}</span><input type="number" min="0" value={outputTokens} onChange={(event) => setOutputTokens(event.target.value)} /></label>
                            </div>

                            <div className="model-table-wrap">
                                <table className="model-comparison-table">
                                    <thead><tr>
                                        {columns.map(([key, label]) => (
                                            <th key={key}><button type="button" onClick={() => changeSort(key)}>{t(`model_comparison.columns.${label}`)} {sortIcon(key)}</button></th>
                                        ))}
                                        <th>{t('model_comparison.columns.monthly_cost')}</th>
                                    </tr></thead>
                                    <tbody>
                                        {models.map((model) => {
                                            const cost = monthlyCost(model);
                                            return (
                                                <tr key={model.id}>
                                                    <td><strong>{model.name}</strong><small>{model.release_date || '—'}</small></td>
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
        </div>
    );
}

export default AIModelComparisonModal;

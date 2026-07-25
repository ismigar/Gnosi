import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Calculator, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './AIModelComparisonModal.css';

const MODEL_DATA = [
    { name: 'DeepSeek V3', provider: 'DeepSeek / OpenRouter', input: 0.14, output: 0.28, context: 128000, speed: 60, uptime: 99.9, quantization: 'FP8', profile: 'administrative' },
    { name: 'DeepSeek R1', provider: 'DeepSeek / OpenRouter', input: 0.55, output: 2.19, context: 128000, speed: 28, uptime: 99.7, quantization: 'FP8', profile: 'expert' },
    { name: 'GPT-4o mini', provider: 'OpenAI', input: 0.15, output: 0.60, context: 128000, speed: 80, uptime: 99.9, quantization: '—', profile: 'worker' },
    { name: 'Gemini 1.5 Pro', provider: 'Google', input: 1.25, output: 5.00, context: 2000000, speed: 45, uptime: 99.9, quantization: '—', profile: 'documentalist' },
    { name: 'Claude 3.5 Sonnet', provider: 'Anthropic', input: 3.00, output: 15.00, context: 200000, speed: 55, uptime: 99.9, quantization: '—', profile: 'allrounder' },
];

const PROFILE_KEYS = ['worker', 'administrative', 'documentalist', 'allrounder', 'expert'];
const PROFILE_ICONS = { worker: '🟢', administrative: '🔵', documentalist: '📑', allrounder: '🟡', expert: '🟣' };

const parseNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

export function AIModelComparisonModal({ isOpen, onClose }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [profile, setProfile] = useState('all');
    const [maxPrice, setMaxPrice] = useState('');
    const [minContext, setMinContext] = useState('');
    const [inputTokens, setInputTokens] = useState(5000000);
    const [outputTokens, setOutputTokens] = useState(1000000);
    const [sort, setSort] = useState({ key: 'input', direction: 'asc' });

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
        return MODEL_DATA
            .filter((model) => (
                (!normalizedQuery || `${model.name} ${model.provider}`.toLocaleLowerCase().includes(normalizedQuery))
                && (profile === 'all' || model.profile === profile)
                && model.input <= priceLimit
                && model.context >= contextFloor
            ))
            .sort((a, b) => {
                const first = a[sort.key];
                const second = b[sort.key];
                const comparison = typeof first === 'string' ? first.localeCompare(second) : first - second;
                return sort.direction === 'asc' ? comparison : -comparison;
            });
    }, [maxPrice, minContext, profile, query, sort]);

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
    const monthlyCost = (model) => (
        (parseNumber(inputTokens) / 1000000) * model.input
        + (parseNumber(outputTokens) / 1000000) * model.output
    );
    const columns = [
        ['name', 'model'], ['provider', 'provider'], ['input', 'input_price'],
        ['output', 'output_price'], ['context', 'context'], ['speed', 'speed'],
        ['uptime', 'uptime'], ['profile', 'profile'],
    ];

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
                                <th>{t('model_comparison.columns.quantization')}</th>
                                <th>{t('model_comparison.columns.monthly_cost')}</th>
                            </tr></thead>
                            <tbody>
                                {models.map((model) => (
                                    <tr key={model.name}>
                                        <td><strong>{model.name}</strong></td>
                                        <td>{model.provider}</td>
                                        <td>${model.input.toFixed(2)}</td>
                                        <td>${model.output.toFixed(2)}</td>
                                        <td>{(model.context / 1000).toLocaleString()}K</td>
                                        <td>{model.speed} t/s</td>
                                        <td>{model.uptime.toFixed(1)}%</td>
                                        <td><span className={`model-profile-badge ${model.profile}`}>{PROFILE_ICONS[model.profile]} {t(`model_comparison.profiles.${model.profile}`)}</span></td>
                                        <td>{model.quantization}</td>
                                        <td><strong>${monthlyCost(model).toFixed(2)}</strong></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        {models.length === 0 && <div className="model-comparison-empty">{t('model_comparison.no_results')}</div>}
                    </div>
                    <p className="model-comparison-note">{t('model_comparison.data_note')}</p>
                </div>
            </section>
        </div>
    );
}

export default AIModelComparisonModal;

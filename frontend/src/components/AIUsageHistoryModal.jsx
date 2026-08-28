import React, { useState, useEffect, useMemo, useRef } from 'react';
import { X, Calendar, BarChart3, Clock, Loader2, ArrowUpRight, Cpu, Layers, Filter, Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './AIUsageHistoryModal.css';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { transportFetch } from '../shared/api/transports';

const PROFILE_ICONS = {
    worker: '🟢',
    administrative: '🔵',
    documentalist: '📑',
    allrounder: '🟡',
    expert: '🟣',
    unrated: '⚪',
};

const formatCost = (value, symbol, digits = 2) => {
    const num = Number(value || 0);
    const formatted = num.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return symbol === '€' ? `${formatted} ${symbol}` : `${symbol}${formatted}`;
};

const formatTokens = (val) => {
    const num = Number(val || 0);
    if (num <= 0) return '0';
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toLocaleString();
};

export function AIUsageHistoryModal({ isOpen, onClose, activeModels = [] }) {
    const { t } = useTranslation();
    const [timeframe, setTimeframe] = useState('month'); // 'day', 'week', 'month', 'quarter', 'semester', 'year', 'all'
    const [groupBy, setGroupBy] = useState('model'); // 'model', 'profile', 'provider'
    const [historyData, setHistoryData] = useState(null);
    const [loading, setLoading] = useState(false);
    const dialogRef = useRef(null);

    useModalKeyboard({ isOpen, onClose, containerRef: dialogRef, trapFocus: true });

    useEffect(() => {
        if (!isOpen) return undefined;
        const controller = new AbortController();
        setLoading(true);
        transportFetch('/api/ai/usage/history', { signal: controller.signal })
            .then(async (res) => {
                if (!res.ok) throw new Error('Failed to load history');
                return res.json();
            })
            .then((data) => setHistoryData(data))
            .catch(() => setHistoryData(null))
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, [isOpen]);

    // Build lookup for active model profiles and names
    const modelProfileMap = useMemo(() => {
        const map = new Map();
        for (const m of activeModels) {
            if (m.model_id) {
                map.set(m.model_id, {
                    name: m.name || m.model_id,
                    profile: m.profile || 'unrated',
                    provider: m.provider || '',
                });
            }
        }
        return map;
    }, [activeModels]);

    // Process and filter historical records
    const processed = useMemo(() => {
        if (!historyData?.periods) return { items: [], totalTokensIn: 0, totalTokensOut: 0, totalCostCcy: 0, curSymbol: '€' };

        const curSymbol = historyData.currency?.symbol || '€';
        const curRate = historyData.currency?.usd_rate || 1.0;
        const allPeriods = Object.keys(historyData.periods).sort().reverse();

        // Filter periods based on timeframe
        const now = new Date();
        const currentPeriodKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        
        let filteredPeriodKeys = allPeriods;
        if (timeframe === 'month') {
            filteredPeriodKeys = allPeriods.filter(p => p === currentPeriodKey);
        } else if (timeframe === 'quarter') {
            // Last 3 months
            filteredPeriodKeys = allPeriods.slice(0, 3);
        } else if (timeframe === 'semester') {
            // Last 6 months
            filteredPeriodKeys = allPeriods.slice(0, 6);
        } else if (timeframe === 'year') {
            // Last 12 months or current year
            filteredPeriodKeys = allPeriods.filter(p => p.startsWith(`${now.getFullYear()}`));
        }

        let totalTokensIn = 0;
        let totalTokensOut = 0;
        let totalCostUsd = 0;

        const groupMap = new Map();

        for (const pKey of filteredPeriodKeys) {
            const periodObj = historyData.periods[pKey];
            if (!periodObj?.models) continue;

            for (const row of periodObj.models) {
                const modelId = row.model_id;
                const provider = row.provider || 'generic';
                const meta = modelProfileMap.get(modelId) || {
                    name: modelId,
                    profile: 'unrated',
                    provider,
                };

                const tokensIn = Number(row.in || 0);
                const tokensOut = Number(row.out || 0);
                const costUsd = Number(row.cost_usd || 0);

                totalTokensIn += tokensIn;
                totalTokensOut += tokensOut;
                totalCostUsd += costUsd;

                let groupKey = modelId;
                let groupLabel = meta.name || modelId;
                let groupSubLabel = provider;
                let groupIcon = Cpu;
                let groupBadge = meta.profile;

                if (groupBy === 'profile') {
                    groupKey = meta.profile || 'unrated';
                    groupLabel = t(`model_comparison.profiles.${groupKey}`, groupKey);
                    groupSubLabel = '';
                    groupIcon = Layers;
                    groupBadge = groupKey;
                } else if (groupBy === 'provider') {
                    groupKey = provider || 'generic';
                    groupLabel = groupKey.toUpperCase();
                    groupSubLabel = `${t('settings.ai.provider', 'Proveïdor')}`;
                    groupIcon = Activity;
                    groupBadge = null;
                }

                if (!groupMap.has(groupKey)) {
                    groupMap.set(groupKey, {
                        key: groupKey,
                        label: groupLabel,
                        subLabel: groupSubLabel,
                        icon: groupIcon,
                        badge: groupBadge,
                        provider,
                        modelId,
                        in: 0,
                        out: 0,
                        costUsd: 0,
                    });
                }

                const existing = groupMap.get(groupKey);
                existing.in += tokensIn;
                existing.out += tokensOut;
                existing.costUsd += costUsd;
            }
        }

        const totalCostCcy = totalCostUsd * curRate;
        const items = Array.from(groupMap.values()).map(g => ({
            ...g,
            costCcy: g.costUsd * curRate,
            percent: totalCostUsd > 0 ? (g.costUsd / totalCostUsd) * 100 : 0,
        })).sort((a, b) => b.costUsd - a.costUsd);

        return { items, totalTokensIn, totalTokensOut, totalCostCcy, curSymbol };
    }, [historyData, timeframe, groupBy, modelProfileMap, t]);

    if (!isOpen) return null;

    return (
        <div className="usage-history-layer" role="presentation">
            <div className="usage-history-backdrop" />
            <section ref={dialogRef} className="usage-history-modal" role="dialog" aria-modal="true" aria-labelledby="usage-history-title">
                <header className="usage-history-header">
                    <div>
                        <h2 id="usage-history-title">
                            <BarChart3 size={20} style={{ color: 'var(--gnosi-blue)' }} />
                            {t('settings.ai.history_title', 'Històric de consum i despesa d’IA')}
                        </h2>
                        <p>{t('settings.ai.history_subtitle', 'Analitza l’evolució del consum de toquens i costos per períodes, perfils i proveïdors.')}</p>
                    </div>
                    <button type="button" className="gnosi-close-btn" onClick={onClose} aria-label={t('common.close', 'Close')} data-autofocus>
                        <X size={20} />
                    </button>
                </header>

                <div className="usage-history-body">
                    {/* Controls Bar */}
                    <div className="usage-history-controls">
                        <div className="usage-history-control-group">
                            <span className="control-label"><Calendar size={14} /> {t('settings.ai.timeframe', 'Vista temporal')}</span>
                            <div className="segmented-control">
                                {[
                                    ['month', t('settings.ai.tf_month', 'Mes actual')],
                                    ['quarter', t('settings.ai.tf_quarter', 'Trimestre (3M)')],
                                    ['semester', t('settings.ai.tf_semester', 'Semestre (6M)')],
                                    ['year', t('settings.ai.tf_year', 'Any')],
                                    ['all', t('settings.ai.tf_all', 'Històric complet')],
                                ].map(([val, label]) => (
                                    <button
                                        key={val}
                                        type="button"
                                        className={timeframe === val ? 'active' : ''}
                                        onClick={() => setTimeframe(val)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="usage-history-control-group">
                            <span className="control-label"><Filter size={14} /> {t('settings.ai.group_by', 'Agrupar per')}</span>
                            <div className="segmented-control">
                                {[
                                    ['model', t('settings.ai.gb_model', 'Model')],
                                    ['profile', t('settings.ai.gb_profile', 'Perfil')],
                                    ['provider', t('settings.ai.gb_provider', 'Proveïdor')],
                                ].map(([val, label]) => (
                                    <button
                                        key={val}
                                        type="button"
                                        className={groupBy === val ? 'active' : ''}
                                        onClick={() => setGroupBy(val)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {loading && (
                        <div className="usage-history-status">
                            <Loader2 className="animate-spin" size={28} />
                            <span>{t('common.loading', 'Carregant històric...')}</span>
                        </div>
                    )}

                    {!loading && (
                        <>
                            {/* Summary KPI Cards */}
                            <div className="usage-history-kpis">
                                <div className="kpi-card">
                                    <span className="kpi-label">{t('settings.ai.total_cost', 'Despesa acumulada')}</span>
                                    <strong className="kpi-value primary">{formatCost(processed.totalCostCcy, processed.curSymbol, 2)}</strong>
                                    <span className="kpi-meta">{t('settings.ai.total_period_cost', 'Període seleccionat')}</span>
                                </div>
                                <div className="kpi-card">
                                    <span className="kpi-label">{t('settings.ai.tokens_in', 'Toquens d’Entrada')}</span>
                                    <strong className="kpi-value">{formatTokens(processed.totalTokensIn)}</strong>
                                    <span className="kpi-meta">Input prompts</span>
                                </div>
                                <div className="kpi-card">
                                    <span className="kpi-label">{t('settings.ai.tokens_out', 'Toquens de Sortida')}</span>
                                    <strong className="kpi-value">{formatTokens(processed.totalTokensOut)}</strong>
                                    <span className="kpi-meta">Output responses</span>
                                </div>
                            </div>

                            {/* Breakdown List */}
                            <div className="usage-history-section-title">
                                <h3>{t('settings.ai.breakdown_title', 'Desglossament de consum')}</h3>
                                <span>{processed.items.length} {t('settings.ai.items_count', 'categories registrades')}</span>
                            </div>

                            <div className="usage-history-items">
                                {processed.items.map((item) => (
                                    <article key={item.key} className="usage-item-card">
                                        <div className="usage-item-header">
                                            <div className="usage-item-identity">
                                                <item.icon size={18} style={{ color: 'var(--gnosi-blue)' }} />
                                                <div>
                                                    <div className="usage-item-name">
                                                        <strong>{item.label}</strong>
                                                        {item.badge && (
                                                            <span className={`model-profile-badge ${item.badge}`}>
                                                                {PROFILE_ICONS[item.badge] || '⚪'} {t(`model_comparison.profiles.${item.badge}`, item.badge)}
                                                            </span>
                                                        )}
                                                    </div>
                                                    {item.subLabel && <span className="usage-item-sub">{item.subLabel}</span>}
                                                </div>
                                            </div>
                                            <div className="usage-item-cost">
                                                <strong>{formatCost(item.costCcy, processed.curSymbol, 2)}</strong>
                                                <span className="usage-item-percent">{item.percent.toFixed(1)}%</span>
                                            </div>
                                        </div>

                                        <div className="usage-item-bar-wrap">
                                            <div className="usage-item-bar" style={{ width: `${Math.max(2, item.percent)}%` }} />
                                        </div>

                                        <div className="usage-item-details">
                                            <span>{t('settings.ai.in_tokens', 'Entrada')}: <strong>{formatTokens(item.in)}</strong></span>
                                            <span>•</span>
                                            <span>{t('settings.ai.out_tokens', 'Sortida')}: <strong>{formatTokens(item.out)}</strong></span>
                                        </div>
                                    </article>
                                ))}

                                {processed.items.length === 0 && (
                                    <div className="usage-history-empty">
                                        <Clock size={32} />
                                        <p>{t('settings.ai.no_history_records', 'No s’han trobat registres de consum per al període o filtre seleccionat.')}</p>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </section>
        </div>
    );
}

export default AIUsageHistoryModal;

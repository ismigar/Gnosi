import type { RefObject } from 'react';
import {
    Activity,
    BarChart3,
    Calendar,
    Clock,
    Cpu,
    Filter,
    Layers,
    Loader2,
    X,
    type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
    formatUsageCost,
    formatUsageTokens,
    type ProcessedUsage,
    type UsageGroup,
    type UsageIcon,
    type UsageTimeframe,
} from './aiUsageHistory';


interface AIUsageHistoryViewProps {
    readonly dialogRef: RefObject<HTMLElement | null>;
    readonly groupBy: UsageGroup;
    readonly isLoading: boolean;
    readonly onClose: () => void;
    readonly onGroupByChange: (group: UsageGroup) => void;
    readonly onTimeframeChange: (timeframe: UsageTimeframe) => void;
    readonly processed: ProcessedUsage;
    readonly timeframe: UsageTimeframe;
}


const PROFILE_ICONS: Readonly<Record<string, string>> = {
    administrative: '🔵',
    allrounder: '🟡',
    documentalist: '📑',
    expert: '🟣',
    unrated: '⚪',
    worker: '🟢',
};


const USAGE_ICONS: Readonly<Record<UsageIcon, LucideIcon>> = {
    model: Cpu,
    profile: Layers,
    provider: Activity,
};


export function AIUsageHistoryView({
    dialogRef,
    groupBy,
    isLoading,
    onClose,
    onGroupByChange,
    onTimeframeChange,
    processed,
    timeframe,
}: AIUsageHistoryViewProps) {
    const { t } = useTranslation();
    const timeframeOptions: readonly (readonly [UsageTimeframe, string])[] = [
        ['month', t('settings.ai.tf_month', 'Mes actual')],
        ['quarter', t('settings.ai.tf_quarter', 'Trimestre (3M)')],
        ['semester', t('settings.ai.tf_semester', 'Semestre (6M)')],
        ['year', t('settings.ai.tf_year', 'Any')],
        ['all', t('settings.ai.tf_all', 'Històric complet')],
    ];
    const groupOptions: readonly (readonly [UsageGroup, string])[] = [
        ['model', t('settings.ai.gb_model', 'Model')],
        ['profile', t('settings.ai.gb_profile', 'Perfil')],
        ['provider', t('settings.ai.gb_provider', 'Proveïdor')],
    ];

    return (
        <div className="usage-history-layer" role="presentation">
            <div className="usage-history-backdrop" />
            <section
                ref={dialogRef}
                aria-labelledby="usage-history-title"
                aria-modal="true"
                className="usage-history-modal"
                role="dialog"
            >
                <header className="usage-history-header">
                    <div>
                        <h2 id="usage-history-title">
                            <BarChart3 size={20} style={{ color: 'var(--gnosi-blue)' }} />
                            {t('settings.ai.history_title', 'Històric de consum i despesa d’IA')}
                        </h2>
                        <p>{t(
                            'settings.ai.history_subtitle',
                            'Analitza l’evolució del consum de toquens i costos per períodes, perfils i proveïdors.',
                        )}</p>
                    </div>
                    <button
                        aria-label={t('common.close', 'Close')}
                        className="gnosi-close-btn"
                        data-autofocus
                        onClick={onClose}
                        type="button"
                    >
                        <X size={20} />
                    </button>
                </header>

                <div className="usage-history-body">
                    <div className="usage-history-controls">
                        <div className="usage-history-control-group">
                            <span className="control-label">
                                <Calendar size={14} />
                                {t('settings.ai.timeframe', 'Vista temporal')}
                            </span>
                            <div className="segmented-control">
                                {timeframeOptions.map(([value, label]) => (
                                    <button
                                        className={timeframe === value ? 'active' : ''}
                                        key={value}
                                        onClick={() => {
                                            onTimeframeChange(value);
                                        }}
                                        type="button"
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="usage-history-control-group">
                            <span className="control-label">
                                <Filter size={14} />
                                {t('settings.ai.group_by', 'Agrupar per')}
                            </span>
                            <div className="segmented-control">
                                {groupOptions.map(([value, label]) => (
                                    <button
                                        className={groupBy === value ? 'active' : ''}
                                        key={value}
                                        onClick={() => {
                                            onGroupByChange(value);
                                        }}
                                        type="button"
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {isLoading ? (
                        <div className="usage-history-status">
                            <Loader2 className="animate-spin" size={28} />
                            <span>{t('common.loading', 'Carregant històric...')}</span>
                        </div>
                    ) : (
                        <>
                            <div className="usage-history-kpis">
                                <div className="kpi-card">
                                    <span className="kpi-label">
                                        {t('settings.ai.total_cost', 'Despesa acumulada')}
                                    </span>
                                    <strong className="kpi-value primary">
                                        {formatUsageCost(
                                            processed.totalCostCcy,
                                            processed.curSymbol,
                                        )}
                                    </strong>
                                    <span className="kpi-meta">
                                        {t('settings.ai.total_period_cost', 'Període seleccionat')}
                                    </span>
                                </div>
                                <div className="kpi-card">
                                    <span className="kpi-label">
                                        {t('settings.ai.tokens_in', 'Toquens d’Entrada')}
                                    </span>
                                    <strong className="kpi-value">
                                        {formatUsageTokens(processed.totalTokensIn)}
                                    </strong>
                                    <span className="kpi-meta">Input prompts</span>
                                </div>
                                <div className="kpi-card">
                                    <span className="kpi-label">
                                        {t('settings.ai.tokens_out', 'Toquens de Sortida')}
                                    </span>
                                    <strong className="kpi-value">
                                        {formatUsageTokens(processed.totalTokensOut)}
                                    </strong>
                                    <span className="kpi-meta">Output responses</span>
                                </div>
                            </div>

                            <div className="usage-history-section-title">
                                <h3>{t('settings.ai.breakdown_title', 'Desglossament de consum')}</h3>
                                <span>
                                    {processed.items.length}
                                    {' '}
                                    {t('settings.ai.items_count', 'categories registrades')}
                                </span>
                            </div>

                            <div className="usage-history-items">
                                {processed.items.map((item) => {
                                    const ItemIcon = USAGE_ICONS[item.icon];
                                    return (
                                        <article className="usage-item-card" key={item.key}>
                                            <div className="usage-item-header">
                                                <div className="usage-item-identity">
                                                    <ItemIcon
                                                        size={18}
                                                        style={{ color: 'var(--gnosi-blue)' }}
                                                    />
                                                    <div>
                                                        <div className="usage-item-name">
                                                            <strong>{item.label}</strong>
                                                            {item.badge ? (
                                                                <span className={`model-profile-badge ${item.badge}`}>
                                                                    {PROFILE_ICONS[item.badge] ?? '⚪'}
                                                                    {' '}
                                                                    {t(
                                                                        `model_comparison.profiles.${item.badge}`,
                                                                        item.badge,
                                                                    )}
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        {item.subLabel ? (
                                                            <span className="usage-item-sub">{item.subLabel}</span>
                                                        ) : null}
                                                    </div>
                                                </div>
                                                <div className="usage-item-cost">
                                                    <strong>{formatUsageCost(
                                                        item.costCcy,
                                                        processed.curSymbol,
                                                    )}</strong>
                                                    <span className="usage-item-percent">
                                                        {item.percent.toFixed(1)}%
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="usage-item-bar-wrap">
                                                <div
                                                    className="usage-item-bar"
                                                    style={{
                                                        width: `${Math.max(2, item.percent).toString()}%`,
                                                    }}
                                                />
                                            </div>

                                            <div className="usage-item-details">
                                                <span>
                                                    {t('settings.ai.in_tokens', 'Entrada')}:
                                                    {' '}
                                                    <strong>{formatUsageTokens(item.in)}</strong>
                                                </span>
                                                <span>•</span>
                                                <span>
                                                    {t('settings.ai.out_tokens', 'Sortida')}:
                                                    {' '}
                                                    <strong>{formatUsageTokens(item.out)}</strong>
                                                </span>
                                            </div>
                                        </article>
                                    );
                                })}

                                {processed.items.length === 0 ? (
                                    <div className="usage-history-empty">
                                        <Clock size={32} />
                                        <p>{t(
                                            'settings.ai.no_history_records',
                                            'No s’han trobat registres de consum per al període o filtre seleccionat.',
                                        )}</p>
                                    </div>
                                ) : null}
                            </div>
                        </>
                    )}
                </div>
            </section>
        </div>
    );
}

import { useEffect, useMemo, useState } from 'react';
import { Download, BarChart3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RefreshButton } from '../../shared/ui/actions/RefreshButton';
import { subscribeAppEvent } from '../../shared/platform/app-events';
import { subscribeDocumentEvent, subscribeWindowEvent } from '../../shared/platform/browser-events';
import { fetchConsumption, fetchConsumptionRequests, exportConsumption, type ConsumptionGroup, type ConsumptionQuery, type UsageDashboard, type UsageRequests } from '../../shared/api/ai-consumption';
import type { SettingsController } from './global-settings/useGlobalSettingsController';
import { ModelBudget } from './global-settings/ModelBudget';
import { ConsumptionChart } from './AIConsumptionCharts';
import { consumptionMetric } from './aiConsumption';
import './AIConsumptionDashboard.css';

const DIMENSIONS: readonly ConsumptionGroup[] = ['model', 'provider', 'agent', 'operation', 'origin', 'profile'];
import { consumptionInterval, type Period } from './aiConsumption';
const PERIODS: readonly Period[] = ['week', 'today', 'days30', 'month', 'previous', 'custom', 'history'];
const isAborted = (signal: AbortSignal): boolean => signal.aborted;
export function AIConsumptionDashboard({ context }: { readonly context: SettingsController }) {
    const { t, i18n } = useTranslation();
    const [period, setPeriod] = useState<Period>('week');
    const [custom, setCustom] = useState(consumptionInterval('week'));
    const [group, setGroup] = useState<ConsumptionGroup>('model');
    const [filters, setFilters] = useState<Partial<Record<ConsumptionGroup, string>>>({});
    const [data, setData] = useState<UsageDashboard | null>(null);
    const [requests, setRequests] = useState<UsageRequests | null>(null);
    const [page, setPage] = useState(1);
    const [refresh, setRefresh] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState(false);
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const interval = period === 'custom' ? custom : consumptionInterval(period);
    const query = useMemo<ConsumptionQuery>(() => ({ start: interval.start, end: interval.end, timezone, group_by: group, granularity: period === 'history' ? 'month' : 'day', ...filters }), [interval.start, interval.end, period, timezone, group, filters]);
    const validInterval = query.start <= query.end && Boolean(query.start && query.end);
    useEffect(() => {
        const controller = new AbortController();
        if (!validInterval) return () => { controller.abort(); };
        void Promise.resolve().then(async () => {
            if (isAborted(controller.signal)) return;
            setLoading(true);
            setError(false);
            try {
                const [dashboard, rows] = await Promise.all([fetchConsumption(query, controller.signal), fetchConsumptionRequests(query, page, controller.signal)]);
                if (!isAborted(controller.signal)) { setData(dashboard); setRequests(rows); }
            } catch {
                if (!isAborted(controller.signal)) setError(true);
            } finally {
                if (!isAborted(controller.signal)) setLoading(false);
            }
        });
        return () => { controller.abort(); };
    }, [query, page, validInterval, context.draft.settings.currency, refresh]);
    useEffect(() => {
        const reload = () => { if (document.visibilityState === 'visible') setRefresh(value => value + 1); };
        const unsubscribeFocus = subscribeWindowEvent('focus', reload);
        const unsubscribeVisibility = subscribeDocumentEvent('visibilitychange', reload);
        const timer = window.setInterval(reload, 30_000);
        const unsubscribe = subscribeAppEvent('gnosi-ai-models-changed', reload);
        return () => { unsubscribeFocus(); unsubscribeVisibility(); window.clearInterval(timer); unsubscribe(); };
    }, []);
    const amount = (value: number | null): string => value === null ? t('settings.ai.consumption.unknown') : new Intl.NumberFormat(i18n.resolvedLanguage, { style: 'currency', currency: data?.currency.code || 'EUR', ...(value > 0 && value < 1 ? { maximumFractionDigits: 6 } : {}) }).format(value);
    const number = (value: number): string => new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
    const label = (value: string): string => {
        if (['unattributed', 'system', 'legacy', 'unrated', 'diagnostic'].includes(value)) return t(`settings.ai.consumption.${value}`);
        for (const prefix of ['agent_execution.skills', 'agent_execution.origins', 'model_comparison.profiles']) {
            const key = `${prefix}.${value}`;
            if (i18n.exists(key)) return t(key);
        }
        return value;
    };
    const changeFilter = (dimension: ConsumptionGroup, value: string) => { setFilters(previous => ({ ...previous, [dimension]: value })); setPage(1); };
    const download = async () => {
        setExporting(true); setExportError(false);
        try {
            const csv = await exportConsumption(query);
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
            const link = document.createElement('a'); link.href = url; link.download = 'gnosi-ai-usage.csv'; link.click(); URL.revokeObjectURL(url);
        } catch { setExportError(true); } finally { setExporting(false); }
    };
    return <section className="consumption-dashboard" aria-label={t('settings.ai.consumption.title')}>
        <header className="consumption-header"><div><h3><BarChart3 size={20} /> {t('settings.ai.consumption.title')}</h3><p>{t('settings.ai.consumption.subtitle')}</p></div><RefreshButton loading={loading} onClick={() => { setRefresh(value => value + 1); }} /></header>
        <div className="consumption-controls">
            <label>{t('settings.ai.consumption.period')}<select className="gnosi-input" value={period} onChange={event => { setPeriod(event.target.value as Period); setPage(1); }}>{PERIODS.map(value => <option key={value} value={value}>{t(`settings.ai.consumption.period_${value}`)}</option>)}</select></label>
            <label>{t('settings.ai.consumption.group_by')}<select className="gnosi-input" value={group} onChange={event => { setGroup(event.target.value as ConsumptionGroup); setPage(1); }}>{DIMENSIONS.map(value => <option key={value} value={value}>{t(`settings.ai.consumption.group_${value}`)}</option>)}</select></label>
            {period === 'custom' && <><label>{t('settings.ai.consumption.from')}<input className="gnosi-input" type="date" value={custom.start} onChange={event => { setCustom(previous => ({ ...previous, start: event.target.value })); setPage(1); }} /></label><label>{t('settings.ai.consumption.to')}<input className="gnosi-input" type="date" value={custom.end} onChange={event => { setCustom(previous => ({ ...previous, end: event.target.value })); setPage(1); }} /></label></>}
        </div>
        <div className="consumption-filters">{DIMENSIONS.map(dimension => <label key={dimension}>{t(`settings.ai.consumption.group_${dimension}`)}<select className="gnosi-input" value={filters[dimension] || ''} onChange={event => { changeFilter(dimension, event.target.value); }}><option value="">{t('settings.ai.consumption.all')}</option>{data?.options[dimension]?.map(option => <option key={option.value} value={option.value}>{label(option.label)}</option>)}</select></label>)}</div>
        {!validInterval && <p role="alert">{t('settings.ai.consumption.invalid_dates')}</p>}
        {error && <p role="alert" className="consumption-notice">{t('settings.ai.consumption.load_error')}</p>}
        {!data && loading && <p role="status">{t('common.loading')}</p>}
        {data && <>
            <p className="consumption-meta">{data.start} — {data.end} · {data.currency.code} · {timezone}</p>
            {(data.summary.unknown_cost_calls > 0 || data.summary.unknown_usage_calls > 0) && <p className="consumption-notice">{t('settings.ai.consumption.incomplete', { count: Math.max(data.summary.unknown_cost_calls, data.summary.unknown_usage_calls) })}</p>}
            {data.summary.estimated_calls > 0 && <p className="consumption-meta">{t('settings.ai.consumption.estimates', { count: data.summary.estimated_calls })}</p>}
            {(data.legacy_excluded || data.summary.legacy_records > 0) && <p className="consumption-notice">{t(data.legacy_excluded ? 'settings.ai.consumption.legacy_excluded' : 'settings.ai.consumption.legacy_note')}</p>}
            <div className="consumption-kpis">{(['cost_ccy', 'calls', 'tokens'] as const).map(metric => <article className="consumption-card" key={metric}>
                <h4>{t(`settings.ai.consumption.${metric === 'cost_ccy' ? 'spend' : metric}`)}</h4><strong className="consumption-value">{data.legacy_excluded && data.summary.calls === 0 || metric === 'calls' && data.summary.legacy_records > 0 ? t('settings.ai.consumption.unknown') : metric === 'cost_ccy' ? amount(data.summary.cost_ccy) : metric === 'tokens' && data.summary.calls > 0 && data.summary.unknown_usage_calls === data.summary.calls && data.summary.legacy_records === 0 ? t('settings.ai.consumption.unknown') : number(consumptionMetric(data.summary, metric))}</strong>
                <ConsumptionChart data={data} metric={metric} format={metric === 'cost_ccy' ? amount : value => number(value ?? 0)} label={label} onSelect={key => { changeFilter(group, key); }} />
            </article>)}</div>
            <div className="consumption-meta">{t('settings.ai.consumption.token_details', { input: number(data.summary.input_tokens), output: number(data.summary.output_tokens), cached: number(data.summary.cached_tokens), reasoning: number(data.summary.reasoning_tokens) })}</div>
            {data.groups.length === 0 && <p>{t('settings.ai.consumption.empty')}</p>}
            <div className="consumption-header"><h4>{t('settings.ai.consumption.requests')}</h4><button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={exporting || loading || !validInterval || error} onClick={() => { void download(); }}><Download size={16} /> {t('settings.ai.consumption.export')}</button></div>
            {exportError && <p role="alert">{t('settings.ai.consumption.export_error')}</p>}
            <div className="consumption-table-wrap"><table className="consumption-table"><thead><tr>{['date', 'group_agent', 'group_operation', 'group_model', 'tokens', 'spend', 'duration', 'status'].map(key => <th key={key}>{t(`settings.ai.consumption.${key}`)}</th>)}</tr></thead><tbody>{requests?.items.map(row => <tr key={row.id}><td>{row.created_at ? new Date(row.created_at).toLocaleString(i18n.resolvedLanguage) : '—'}</td><td>{label(row.agent_name || row.agent_id)}</td><td>{label(row.operation || 'unattributed')}<small>{label(row.origin)}</small></td><td>{row.model_id}<small>{row.provider}</small></td><td>{row.input_tokens === null || row.output_tokens === null ? t('settings.ai.consumption.unknown') : `${number(row.input_tokens)} / ${number(row.output_tokens)}`}</td><td>{amount(row.cost_ccy)}<small>{t(`settings.ai.consumption.source_${row.cost_source}`)}</small></td><td>{number(Math.round(row.duration_ms))} ms</td><td>{t(`settings.ai.consumption.status_${row.status}`)}</td></tr>)}</tbody></table></div>
            <div className="consumption-pagination"><button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={page <= 1 || loading} onClick={() => { setPage(value => value - 1); }}>{t('settings.ai.consumption.previous')}</button><span>{page} / {Math.max(1, Math.ceil((requests?.total || 0) / 25))} · {t('settings.ai.consumption.call_count', { count: requests?.total || 0 })}</span><button className="btn-gnosi btn-gnosi-secondary" type="button" disabled={page * 25 >= (requests?.total || 0) || loading} onClick={() => { setPage(value => value + 1); }}>{t('settings.ai.consumption.next')}</button></div>
            <p className="consumption-meta">{t('settings.ai.consumption.fx', { rate: data.currency.usd_rate, currency: data.currency.code, date: data.currency.fetched_at || '—', source: data.currency.source })}</p>
            <ModelBudget context={{ ...context, aiUsage: data.budget }} />
            {(data.budget.cap_ccy ?? 0) > 0 && <p className="consumption-meta">{t('settings.ai.consumption.remaining', { amount: amount(Math.max(0, (data.budget.cap_ccy ?? 0) - data.budget.spent_ccy)) })}</p>}
            {data.budget_summary.unknown_cost_calls > 0 && <p className="consumption-notice">{t('settings.ai.consumption.budget_partial')}</p>}
            {data.budget_summary.estimated_calls > 0 && <p className="consumption-meta">{t('settings.ai.consumption.budget_estimated')}</p>}
        </>}
    </section>;
}

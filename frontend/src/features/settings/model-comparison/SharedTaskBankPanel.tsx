import { useTranslation } from 'react-i18next';
import type { SharedEvaluationBank } from '../../../shared/api/ai-activity';
import { formatComparisonCost } from '../modelComparison';
import { RefreshButton } from '../../../shared/ui/actions/RefreshButton';

export function SharedTaskBankPanel({ bank, onRefresh, currency }: {
    readonly currency?: { usd_rate: number; symbol: string }; readonly bank?: SharedEvaluationBank; readonly onRefresh: () => void;
}) {
    const { t } = useTranslation();
    const money = (usd?: number | null) => usd == null || !currency ? t('model_comparison.unknown_cost') : formatComparisonCost(usd * currency.usd_rate, currency.symbol);
    const observations = bank?.summaries?.reduce((sum, item) => sum + item.observations, 0) ?? 0;
    return <details className="model-task-recommendations__requirements">
        <summary>{t('model_comparison.shared.title')} · {observations}</summary>
        <header className="model-task-recommendations__header"><p>{t('model_comparison.shared.help')}</p>
            <RefreshButton onClick={onRefresh} /></header>
        <p role="status">{t(`model_comparison.shared.${bank?.state ?? 'unavailable'}`)}</p>
        {bank?.fetched_at && <p>{t('model_comparison.shared.updated', { date: new Date(bank.fetched_at).toLocaleString() })}</p>}
        <p>{t('model_comparison.shared.requirements')}</p>
        <p>{t('model_comparison.shared.cost_help')}</p>
        {bank && <a href={bank.repository_url} target="_blank" rel="noreferrer">{t('model_comparison.shared.repository')}</a>}
        {bank && observations === 0 && bank.state !== 'unavailable' && <p>{t('model_comparison.shared.empty')}</p>}
        {bank?.summaries?.map((item, index) => <details key={`${item.provider}:${item.model}:${String(index)}`}>
            <summary>{item.model} · {item.provider}</summary>
            <p>{t('model_comparison.shared.counts', { count: item.observations, users: item.contributors,
                passed: item.passed, failed: item.failed, inconclusive: item.inconclusive })}</p>
            <p>{t('model_comparison.shared.latency', { seconds: ((item.median_latency_ms ?? 0) / 1000).toFixed(2), minimum: (item.minimum_latency_ms / 1000).toFixed(2), maximum: (item.maximum_latency_ms / 1000).toFixed(2) })}</p>
            <p>{t('model_comparison.shared.cost', { median: money(item.median_cost_usd), minimum: money(item.minimum_cost_usd), maximum: money(item.maximum_cost_usd) })}
                {' · '}{item.cost_sources.map(source => t(`model_comparison.tests.cost_${source}`)).join(', ')}</p>
        </details>)}
    </details>;
}

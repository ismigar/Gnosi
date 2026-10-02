import type { UsageSummary } from '../../shared/api/ai-consumption';
export type Metric = 'cost_ccy' | 'calls' | 'tokens';
export function consumptionMetric(row: UsageSummary, metric: Metric): number {
    return metric === 'tokens' ? row.input_tokens + row.output_tokens : row[metric] ?? 0;
}
export type Period = 'week' | 'today' | 'days30' | 'month' | 'previous' | 'custom' | 'history';
function dateValue(date: Date): string {
    return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function consumptionInterval(period: Period, now = new Date()): { start: string; end: string } {
    const start = new Date(now);
    const end = new Date(now);
    if (period === 'week') start.setDate(start.getDate() - 6);
    if (period === 'days30') start.setDate(start.getDate() - 29);
    if (period === 'month') start.setDate(1);
    if (period === 'previous') { start.setDate(1); start.setMonth(start.getMonth() - 1); end.setDate(0); }
    if (period === 'history') { start.setFullYear(2000, 0, 1); }
    return { start: dateValue(start), end: dateValue(end) };
}

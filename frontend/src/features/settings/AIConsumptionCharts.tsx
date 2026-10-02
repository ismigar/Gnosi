import { useTranslation } from 'react-i18next';
import type { UsageDashboard } from '../../shared/api/ai-consumption';

import { consumptionMetric, type Metric } from './aiConsumption';
const COLORS = ['var(--gnosi-primary)', 'var(--color-success, #22a67a)', 'var(--color-warning, #d5a027)', 'var(--color-info, #5c8ed6)', 'var(--color-danger, #da6474)', 'var(--text-tertiary)'];
export function ConsumptionChart({ data, metric, format, label, onSelect }: {
    readonly data: UsageDashboard;
    readonly metric: Metric;
    readonly format: (value: number | null) => string;
    readonly label: (value: string) => string;
    readonly onSelect: (key: string) => void;
}) {
    const { t } = useTranslation();
    const ranked = [...data.groups].sort((a, b) => consumptionMetric(b, metric) - consumptionMetric(a, metric));
    const top = ranked.slice(0, 5);
    const keys = new Set(top.map(item => item.key));
    const categories = [...top.map(item => ({ key: item.key, label: label(item.label), value: consumptionMetric(item, metric) })), ...(ranked.length > 5 ? [{ key: '__others__', label: t('settings.ai.consumption.others'), value: ranked.slice(5).reduce((sum, row) => sum + consumptionMetric(row, metric), 0) }] : [])];
    const max = Math.max(Number.EPSILON, ...data.series.map(row => consumptionMetric(row, metric)));
    const width = 360;
    const chartHeight = 100;
    const barWidth = Math.min(30, 320 / Math.max(data.series.length, 1));
    return <>
        <svg className="consumption-chart" viewBox={`0 0 ${String(width)} 130`} role="img" aria-label={t(`settings.ai.consumption.${metric === 'cost_ccy' ? 'spend' : metric}`)}>
            <line x1="20" x2="350" y1="105" y2="105" stroke="var(--border-color)" />
            {data.series.map((bucket, index) => {
                let accumulated = 0;
                const x = 20 + (index + 0.5) * (330 / Math.max(data.series.length, 1));
                return <g key={bucket.date}>
                    {categories.map((category, colorIndex) => {
                        const value = bucket.groups.filter(row => category.key === '__others__' ? !keys.has(row.key) : row.key === category.key).reduce((sum, row) => sum + consumptionMetric(row, metric), 0);
                        const height = value / max * chartHeight;
                        accumulated += height;
                        return <rect key={category.key} x={x - barWidth / 2} y={105 - accumulated} width={barWidth} height={height} fill={COLORS[colorIndex]}><title>{`${bucket.date} · ${category.label}: ${format(value)}`}</title></rect>;
                    })}
                </g>;
            })}
            <text x="20" y="123" fill="var(--text-secondary)" fontSize="10">{data.series[0]?.date}</text>
            <text x="350" y="123" textAnchor="end" fill="var(--text-secondary)" fontSize="10">{data.series.at(-1)?.date}</text>
        </svg>
        <div className="consumption-legend">
            {categories.map((category, index) => <button className="consumption-legend-row" key={category.key} type="button" disabled={category.key === '__others__'} onClick={() => { onSelect(category.key); }}>
                <span className="consumption-dot" style={{ background: COLORS[index] }} /><span title={category.label}>{category.label}</span><strong>{format(category.value)}</strong>
            </button>)}
        </div>
    </>;
}

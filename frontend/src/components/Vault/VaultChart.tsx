import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';

import { periodBoundary, type PeriodInput } from '../../utils/projectPlanning';
import { getFieldType, getMetaValue } from './schemaUtils';
import {
    HorizontalBars,
    LineChart,
    PieChart,
    VerticalBars,
} from './vault-chart/VaultChartRenderers';
import {
    buildChartData,
    chartScalarText,
    type ChartSourceRecord,
} from './vault-chart/vaultChartModel';


export type VaultChartSchema = Readonly<Record<string, unknown>>;


export interface VaultChartNote {
    readonly [key: string]: unknown;
}


export interface VaultChartView {
    readonly aggregation?: unknown;
    readonly chartType?: unknown;
    readonly xField?: unknown;
    readonly yField?: unknown;
}


export interface VaultChartProps {
    readonly activeView?: VaultChartView;
    readonly notes?: readonly VaultChartNote[];
    readonly schema?: VaultChartSchema;
}


const readFieldType = getFieldType as (
    schema: VaultChartSchema,
    field: string,
) => string;
const readMetaValue = getMetaValue as (
    note: VaultChartNote,
    schema: VaultChartSchema,
    field: string,
) => unknown;


function isPeriodInput(value: unknown): value is PeriodInput {
    if (
        value === null
        || value === undefined
        || typeof value === 'string'
        || typeof value === 'number'
        || typeof value === 'bigint'
        || typeof value === 'boolean'
    ) return true;
    return value instanceof Date
        || (typeof value === 'object' && !Array.isArray(value));
}


export function VaultChart({
    activeView = {},
    notes = [],
    schema = {},
}: VaultChartProps) {
    const { t } = useTranslation();
    const chartType = (chartScalarText(activeView.chartType) || 'bar').toLowerCase();
    const xField = typeof activeView.xField === 'string' ? activeView.xField : '';
    const yField = typeof activeView.yField === 'string' ? activeView.yField : '';
    const aggregation = (
        chartScalarText(activeView.aggregation) || (yField ? 'sum' : 'count')
    ).toLowerCase();
    const data = useMemo(() => {
        if (!xField) return [];
        const xType = readFieldType(schema, xField);
        const records: ChartSourceRecord[] = notes.map((note) => {
            const rawCategory = readMetaValue(note, schema, xField);
            return {
                category: xType === 'period'
                    ? periodBoundary(isPeriodInput(rawCategory) ? rawCategory : null, 'start')
                    : rawCategory,
                value: yField ? readMetaValue(note, schema, yField) : null,
            };
        });
        return buildChartData({
            aggregation,
            emptyLabel: t('chart.empty_category', '(empty)'),
            records,
            temporalCategory: ['date', 'datetime', 'period'].includes(xType),
            usesValueField: Boolean(yField),
        });
    }, [aggregation, notes, schema, t, xField, yField]);

    if (!xField) return <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-[var(--text-tertiary)]">
        <BarChart3 className="opacity-40" size={40} />
        <div className="max-w-sm text-sm">
            <Trans
                components={{ field: <strong />, value: <strong /> }}
                defaults="Configure the chart: choose a <field>grouping</field> field (X axis) and, optionally, a <value>value</value> field and aggregation function from the view menu."
                i18nKey="chart.configure_hint"
            />
        </div>
    </div>;
    if (data.length === 0) return <div className="py-16 text-center text-sm text-[var(--text-tertiary)]">{t('chart.no_data', 'No data to display.')}</div>;

    const maxValue = Math.max(...data.map(({ value }) => value), 0) || 1;
    const pieData = data.filter(({ value }) => value > 0);
    const pieTotal = pieData.reduce((total, point) => total + point.value, 0) || 1;
    const yLabel = yField
        ? `${aggregation}(${yField})`
        : t('chart.count_label', 'count');

    return <div className="vault-chart overflow-auto p-4">
        <div className="mb-3 text-xs font-medium text-[var(--text-tertiary)]">
            <Trans
                components={{ field: <strong className="text-[var(--text-secondary)]" /> }}
                defaults="{{yLabel}} per <field>{{xField}}</field>"
                i18nKey="chart.axis_summary"
                values={{ xField, yLabel }}
            />
        </div>
        {chartType === 'bar' ? <VerticalBars data={data} maxValue={maxValue} /> : null}
        {chartType === 'hbar' ? <HorizontalBars data={data} maxValue={maxValue} /> : null}
        {chartType === 'line' ? <LineChart data={data} maxValue={maxValue} /> : null}
        {chartType === 'pie' || chartType === 'donut'
            ? pieData.length > 0
                ? <PieChart data={pieData} donut={chartType === 'donut'} total={pieTotal} />
                : <div className="py-16 text-center text-sm text-[var(--text-tertiary)]">{t('chart.no_data', 'No data to display.')}</div>
            : null}
    </div>;
}


export default VaultChart;

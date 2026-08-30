export type ChartAggregation = 'avg' | 'count' | 'max' | 'min' | 'sum';


export interface ChartDataPoint {
    readonly label: string;
    readonly value: number;
}


export interface ChartSourceRecord {
    readonly category: unknown;
    readonly value: unknown;
}


export interface BuildChartDataOptions {
    readonly aggregation: string;
    readonly emptyLabel: string;
    readonly records: readonly ChartSourceRecord[];
    readonly temporalCategory: boolean;
    readonly usesValueField: boolean;
}


function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}


export function chartScalarText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (
        typeof value === 'number'
        || typeof value === 'bigint'
        || typeof value === 'boolean'
    ) return String(value);
    return '';
}


export function chartNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const normalized = chartScalarText(value)
        .trim()
        .replace(/\s+/gu, '')
        .replace(',', '.');
    const number = Number.parseFloat(normalized);
    return Number.isFinite(number) ? number : null;
}


export function chartCategoryLabels(value: unknown, emptyLabel: string): string[] {
    if (value === null || value === undefined || value === '') return [emptyLabel];
    if (Array.isArray(value)) {
        const labels = value
            .map((item) => isRecord(item)
                ? chartScalarText(item.name)
                : chartScalarText(item))
            .filter(Boolean);
        return labels.length > 0 ? labels : [emptyLabel];
    }
    if (isRecord(value)) {
        return [chartScalarText(value.name) || chartScalarText(value.title) || emptyLabel];
    }
    const label = chartScalarText(value).trim();
    return label ? [label] : [emptyLabel];
}


export function aggregateChartValues(
    values: readonly (number | null)[],
    aggregation: string,
): number {
    const numbers = values.filter((value): value is number => value !== null);
    if (aggregation === 'count') return values.length;
    if (numbers.length === 0) return 0;
    if (aggregation === 'sum') return numbers.reduce((total, value) => total + value, 0);
    if (aggregation === 'avg') {
        return numbers.reduce((total, value) => total + value, 0) / numbers.length;
    }
    if (aggregation === 'min') return Math.min(...numbers);
    if (aggregation === 'max') return Math.max(...numbers);
    return values.length;
}


export function buildChartData({
    aggregation,
    emptyLabel,
    records,
    temporalCategory,
    usesValueField,
}: BuildChartDataOptions): ChartDataPoint[] {
    const buckets = new Map<string, Array<number | null>>();
    for (const record of records) {
        const labels = chartCategoryLabels(record.category, emptyLabel);
        const numericValue = usesValueField ? chartNumber(record.value) : 1;
        for (const label of labels) {
            const values = buckets.get(label) ?? [];
            values.push(numericValue);
            buckets.set(label, values);
        }
    }
    const data = [...buckets.entries()].map(([label, values]) => ({
        label,
        value: aggregateChartValues(values, aggregation),
    }));
    data.sort(temporalCategory
        ? (first, second) => first.label.localeCompare(second.label)
        : (first, second) => second.value - first.value);
    return data;
}


export function formatChartNumber(value: number): string {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded)
        ? String(rounded)
        : rounded.toFixed(2).replace('.', ',');
}


export function truncateChartLabel(label: string, length: number): string {
    return label.length > length ? `${label.slice(0, length - 1)}…` : label;
}

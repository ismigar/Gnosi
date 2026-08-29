import {
    formatChartNumber,
    truncateChartLabel,
    type ChartDataPoint,
} from './vaultChartModel';


const CHART_PALETTE = [
    '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6',
    '#ec4899', '#14b8a6', '#f97316', '#84cc16', '#3b82f6', '#a855f7',
] as const;


function chartColor(index: number): string {
    return CHART_PALETTE[index % CHART_PALETTE.length] ?? '#6366f1';
}


interface CartesianChartProps {
    readonly data: readonly ChartDataPoint[];
    readonly maxValue: number;
}


interface PieChartProps {
    readonly data: readonly ChartDataPoint[];
    readonly donut: boolean;
    readonly total: number;
}


interface PieSlice {
    readonly color: string;
    readonly data: ChartDataPoint;
    readonly fraction: number;
    readonly path: string;
}


export function VerticalBars({ data, maxValue }: CartesianChartProps) {
    const width = Math.max(320, data.length * 70);
    const height = 280;
    const padding = { bottom: 56, left: 44, right: 12, top: 20 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const barWidth = Math.min(56, (innerWidth / data.length) * 0.6);
    return <svg role="img" style={{ maxWidth: width }} viewBox={`0 0 ${String(width)} ${String(height)}`} width="100%">
        <line stroke="var(--border-primary)" x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + innerHeight} />
        <line stroke="var(--border-primary)" x1={padding.left} x2={padding.left + innerWidth} y1={padding.top + innerHeight} y2={padding.top + innerHeight} />
        {data.map((point, index) => {
            const x = padding.left + (innerWidth / data.length) * (index + 0.5);
            const barHeight = (point.value / maxValue) * innerHeight;
            const y = padding.top + innerHeight - barHeight;
            return <g key={point.label}>
                <rect fill={chartColor(index)} height={Math.max(0, barHeight)} rx={4} width={barWidth} x={x - barWidth / 2} y={y}>
                    <title>{`${point.label}: ${formatChartNumber(point.value)}`}</title>
                </rect>
                <text fill="var(--text-secondary)" fontSize="11" textAnchor="middle" x={x} y={y - 5}>{formatChartNumber(point.value)}</text>
                <text fill="var(--text-tertiary)" fontSize="11" textAnchor="middle" x={x} y={padding.top + innerHeight + 16}>{truncateChartLabel(point.label, 10)}</text>
            </g>;
        })}
    </svg>;
}


export function HorizontalBars({ data, maxValue }: CartesianChartProps) {
    const rowHeight = 30;
    const width = 560;
    const labelWidth = 130;
    const height = data.length * rowHeight + 20;
    const innerWidth = width - labelWidth - 60;
    return <svg role="img" style={{ maxWidth: width }} viewBox={`0 0 ${String(width)} ${String(height)}`} width="100%">
        {data.map((point, index) => {
            const y = 10 + index * rowHeight;
            const barWidth = (point.value / maxValue) * innerWidth;
            return <g key={point.label}>
                <text dominantBaseline="middle" fill="var(--text-secondary)" fontSize="12" textAnchor="end" x={labelWidth - 8} y={y + rowHeight / 2}>{truncateChartLabel(point.label, 16)}</text>
                <rect fill={chartColor(index)} height={rowHeight - 12} rx={4} width={Math.max(2, barWidth)} x={labelWidth} y={y + 4}>
                    <title>{`${point.label}: ${formatChartNumber(point.value)}`}</title>
                </rect>
                <text dominantBaseline="middle" fill="var(--text-tertiary)" fontSize="11" x={labelWidth + barWidth + 6} y={y + rowHeight / 2}>{formatChartNumber(point.value)}</text>
            </g>;
        })}
    </svg>;
}


export function LineChart({ data, maxValue }: CartesianChartProps) {
    const width = Math.max(320, data.length * 70);
    const height = 280;
    const padding = { bottom: 56, left: 44, right: 16, top: 20 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const points = data.map((point, index) => ({
        data: point,
        x: padding.left + (data.length === 1
            ? innerWidth / 2
            : (innerWidth / (data.length - 1)) * index),
        y: padding.top + innerHeight - (point.value / maxValue) * innerHeight,
    }));
    const path = points.map((point, index) => (
        `${index === 0 ? 'M' : 'L'} ${String(point.x)} ${String(point.y)}`
    )).join(' ');
    return <svg role="img" style={{ maxWidth: width }} viewBox={`0 0 ${String(width)} ${String(height)}`} width="100%">
        <line stroke="var(--border-primary)" x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + innerHeight} />
        <line stroke="var(--border-primary)" x1={padding.left} x2={padding.left + innerWidth} y1={padding.top + innerHeight} y2={padding.top + innerHeight} />
        <path d={path} fill="none" stroke={chartColor(0)} strokeWidth="2" />
        {points.map((point) => <g key={point.data.label}>
            <circle cx={point.x} cy={point.y} fill={chartColor(0)} r="4"><title>{`${point.data.label}: ${formatChartNumber(point.data.value)}`}</title></circle>
            <text fill="var(--text-tertiary)" fontSize="11" textAnchor="middle" x={point.x} y={padding.top + innerHeight + 16}>{truncateChartLabel(point.data.label, 10)}</text>
        </g>)}
    </svg>;
}


export function PieChart({ data, donut, total }: PieChartProps) {
    const size = 240;
    const center = size / 2;
    const radius = size / 2 - 8;
    const innerRadius = donut ? radius * 0.55 : 0;
    const result = data.reduce<{ angle: number; slices: PieSlice[] }>((state, point, index) => {
        const fraction = point.value / total;
        const start = state.angle;
        const end = start + fraction * Math.PI * 2;
        const large = end - start > Math.PI ? 1 : 0;
        const x0 = center + radius * Math.cos(start);
        const y0 = center + radius * Math.sin(start);
        const x1 = center + radius * Math.cos(end);
        const y1 = center + radius * Math.sin(end);
        let path: string;
        if (innerRadius > 0) {
            const innerX0 = center + innerRadius * Math.cos(start);
            const innerY0 = center + innerRadius * Math.sin(start);
            const innerX1 = center + innerRadius * Math.cos(end);
            const innerY1 = center + innerRadius * Math.sin(end);
            path = `M ${String(x0)} ${String(y0)} A ${String(radius)} ${String(radius)} 0 ${String(large)} 1 ${String(x1)} ${String(y1)} L ${String(innerX1)} ${String(innerY1)} A ${String(innerRadius)} ${String(innerRadius)} 0 ${String(large)} 0 ${String(innerX0)} ${String(innerY0)} Z`;
        } else {
            path = `M ${String(center)} ${String(center)} L ${String(x0)} ${String(y0)} A ${String(radius)} ${String(radius)} 0 ${String(large)} 1 ${String(x1)} ${String(y1)} Z`;
        }
        return {
            angle: end,
            slices: [...state.slices, {
                color: chartColor(index),
                data: point,
                fraction,
                path,
            }],
        };
    }, { angle: -Math.PI / 2, slices: [] });
    return <div className="flex flex-wrap items-center gap-6">
        <svg height={size} role="img" viewBox={`0 0 ${String(size)} ${String(size)}`} width={size}>
            {result.slices.map((slice) => <path d={slice.path} fill={slice.color} key={slice.data.label} stroke="var(--bg-primary)" strokeWidth="1.5"><title>{`${slice.data.label}: ${formatChartNumber(slice.data.value)} (${String(Math.round(slice.fraction * 100))}%)`}</title></path>)}
        </svg>
        <ul className="space-y-1 text-sm">
            {result.slices.map((slice) => <li className="flex items-center gap-2" key={slice.data.label}>
                <span className="inline-block h-3 w-3 rounded-sm" style={{ background: slice.color }} />
                <span className="text-[var(--text-secondary)]">{truncateChartLabel(slice.data.label, 22)}</span>
                <span className="text-[var(--text-tertiary)]">· {formatChartNumber(slice.data.value)} ({Math.round(slice.fraction * 100)}%)</span>
            </li>)}
        </ul>
    </div>;
}

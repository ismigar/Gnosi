import React, { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { getMetaValue, getFieldType } from './schemaUtils';

/**
 * VaultChart
 * Vista de gràfics sobre una base de dades del Vault (estil "Charts" de Notion).
 * Agrega les files per un camp de categoria (`xField`) i hi aplica una funció
 * (`aggregation`) sobre un camp numèric (`yField`) o un recompte. Renderitza amb
 * SVG propi (sense dependències): barres verticals/horitzontals, línia o pastís.
 *
 * La configuració viu a `activeView` (registry, format lliure):
 *   { type:'chart', chartType:'bar'|'hbar'|'line'|'pie'|'donut',
 *     xField:'<camp>', yField:'<camp>', aggregation:'count'|'sum'|'avg'|'min'|'max' }
 */

// Paleta de categories (consistents entre render).
const PALETTE = [
    '#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
    '#3b82f6', '#a855f7',
];

// Converteix un valor a número (admet coma decimal: "12,5" → 12.5).
const toNum = (v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim().replace(/\s+/g, '').replace(',', '.');
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
};

// Normalitza el valor d'una categoria a una o més etiquetes (string).
const categoryLabels = (raw) => {
    if (raw === null || raw === undefined || raw === '') return ['(buit)'];
    if (Array.isArray(raw)) {
        const out = raw.map((x) => (x && typeof x === 'object' ? String(x.name ?? '') : String(x))).filter((s) => s !== '');
        return out.length ? out : ['(buit)'];
    }
    if (typeof raw === 'object') return [String(raw.name ?? raw.title ?? '(buit)')];
    const s = String(raw).trim();
    return s ? [s] : ['(buit)'];
};

const aggregate = (values, fn) => {
    const nums = values.filter((v) => v !== null);
    if (fn === 'count') return values.length;
    if (nums.length === 0) return 0;
    switch (fn) {
        case 'sum': return nums.reduce((a, b) => a + b, 0);
        case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
        case 'min': return Math.min(...nums);
        case 'max': return Math.max(...nums);
        default: return values.length;
    }
};

const fmtNum = (n) => {
    if (!Number.isFinite(n)) return '0';
    const r = Math.round(n * 100) / 100;
    return Number.isInteger(r) ? String(r) : r.toFixed(2).replace('.', ',');
};

export function VaultChart({ notes = [], schema = {}, activeView = {} }) {
    const chartType = String(activeView?.chartType || 'bar').toLowerCase();
    const xField = activeView?.xField || '';
    const yField = activeView?.yField || '';
    const aggregation = String(activeView?.aggregation || (yField ? 'sum' : 'count')).toLowerCase();

    const data = useMemo(() => {
        if (!xField) return [];
        const buckets = new Map(); // label → array de valors (per agregar)
        for (const note of notes) {
            const rawCat = getMetaValue(note, schema, xField);
            const labels = categoryLabels(rawCat);
            const rawVal = yField ? getMetaValue(note, schema, yField) : null;
            const num = yField ? toNum(rawVal) : null;
            for (const label of labels) {
                if (!buckets.has(label)) buckets.set(label, []);
                buckets.get(label).push(yField ? num : 1);
            }
        }
        const rows = Array.from(buckets.entries()).map(([label, vals]) => ({
            label,
            value: aggregate(yField ? vals : vals, aggregation),
        }));
        // Ordena descendent per valor (com Notion) excepte si l'eix X és temporal.
        const xType = getFieldType(schema, xField);
        if (xType === 'date') rows.sort((a, b) => String(a.label).localeCompare(String(b.label)));
        else rows.sort((a, b) => b.value - a.value);
        return rows;
    }, [notes, schema, xField, yField, aggregation]);

    if (!xField) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-[var(--text-tertiary)]">
                <BarChart3 size={40} className="opacity-40" />
                <div className="max-w-sm text-sm">
                    Configura el gràfic: tria un camp d'<strong>agrupació</strong> (eix X) i, opcionalment,
                    un camp de <strong>valor</strong> i una funció d'agregació al menú de la vista.
                </div>
            </div>
        );
    }

    if (data.length === 0) {
        return <div className="py-16 text-center text-sm text-[var(--text-tertiary)]">Cap dada per mostrar.</div>;
    }

    const maxVal = Math.max(...data.map((d) => d.value), 0) || 1;
    const total = data.reduce((a, d) => a + d.value, 0) || 1;
    const yLabel = yField ? `${aggregation}(${yField})` : 'recompte';

    return (
        <div className="vault-chart overflow-auto p-4">
            <div className="mb-3 text-xs font-medium text-[var(--text-tertiary)]">
                {yLabel} per <strong className="text-[var(--text-secondary)]">{xField}</strong>
            </div>
            {(chartType === 'bar') && <VerticalBars data={data} maxVal={maxVal} />}
            {(chartType === 'hbar') && <HorizontalBars data={data} maxVal={maxVal} />}
            {(chartType === 'line') && <LineChart data={data} maxVal={maxVal} />}
            {(chartType === 'pie' || chartType === 'donut') && (
                <PieChart data={data} total={total} donut={chartType === 'donut'} />
            )}
        </div>
    );
}

// ── Barres verticals ────────────────────────────────────────────────────────
function VerticalBars({ data, maxVal }) {
    const W = Math.max(320, data.length * 70);
    const H = 280;
    const pad = { top: 20, right: 12, bottom: 56, left: 44 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;
    const bw = Math.min(56, (innerW / data.length) * 0.6);
    return (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img">
            <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + innerH} stroke="var(--border-primary)" />
            <line x1={pad.left} y1={pad.top + innerH} x2={pad.left + innerW} y2={pad.top + innerH} stroke="var(--border-primary)" />
            {data.map((d, i) => {
                const x = pad.left + (innerW / data.length) * (i + 0.5);
                const h = (d.value / maxVal) * innerH;
                const y = pad.top + innerH - h;
                return (
                    <g key={i}>
                        <rect x={x - bw / 2} y={y} width={bw} height={Math.max(0, h)} rx={4} fill={PALETTE[i % PALETTE.length]}>
                            <title>{`${d.label}: ${fmtNum(d.value)}`}</title>
                        </rect>
                        <text x={x} y={y - 5} textAnchor="middle" fontSize="11" fill="var(--text-secondary)">{fmtNum(d.value)}</text>
                        <text x={x} y={pad.top + innerH + 16} textAnchor="middle" fontSize="11" fill="var(--text-tertiary)">
                            {truncate(d.label, 10)}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}

// ── Barres horitzontals ─────────────────────────────────────────────────────
function HorizontalBars({ data, maxVal }) {
    const rowH = 30;
    const W = 560;
    const labelW = 130;
    const H = data.length * rowH + 20;
    const innerW = W - labelW - 60;
    return (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img">
            {data.map((d, i) => {
                const y = 10 + i * rowH;
                const w = (d.value / maxVal) * innerW;
                return (
                    <g key={i}>
                        <text x={labelW - 8} y={y + rowH / 2} textAnchor="end" dominantBaseline="middle" fontSize="12" fill="var(--text-secondary)">
                            {truncate(d.label, 16)}
                        </text>
                        <rect x={labelW} y={y + 4} width={Math.max(2, w)} height={rowH - 12} rx={4} fill={PALETTE[i % PALETTE.length]}>
                            <title>{`${d.label}: ${fmtNum(d.value)}`}</title>
                        </rect>
                        <text x={labelW + w + 6} y={y + rowH / 2} dominantBaseline="middle" fontSize="11" fill="var(--text-tertiary)">{fmtNum(d.value)}</text>
                    </g>
                );
            })}
        </svg>
    );
}

// ── Línia ───────────────────────────────────────────────────────────────────
function LineChart({ data, maxVal }) {
    const W = Math.max(320, data.length * 70);
    const H = 280;
    const pad = { top: 20, right: 16, bottom: 56, left: 44 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;
    const pts = data.map((d, i) => {
        const x = pad.left + (data.length === 1 ? innerW / 2 : (innerW / (data.length - 1)) * i);
        const y = pad.top + innerH - (d.value / maxVal) * innerH;
        return { x, y, d };
    });
    const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    return (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W }} role="img">
            <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + innerH} stroke="var(--border-primary)" />
            <line x1={pad.left} y1={pad.top + innerH} x2={pad.left + innerW} y2={pad.top + innerH} stroke="var(--border-primary)" />
            <path d={path} fill="none" stroke={PALETTE[0]} strokeWidth="2" />
            {pts.map((p, i) => (
                <g key={i}>
                    <circle cx={p.x} cy={p.y} r="4" fill={PALETTE[0]}>
                        <title>{`${p.d.label}: ${fmtNum(p.d.value)}`}</title>
                    </circle>
                    <text x={p.x} y={pad.top + innerH + 16} textAnchor="middle" fontSize="11" fill="var(--text-tertiary)">{truncate(p.d.label, 10)}</text>
                </g>
            ))}
        </svg>
    );
}

// ── Pastís / Donut ──────────────────────────────────────────────────────────
function PieChart({ data, total, donut }) {
    const size = 240;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 8;
    const rInner = donut ? r * 0.55 : 0;
    let angle = -Math.PI / 2;
    const slices = data.map((d, i) => {
        const frac = d.value / total;
        const a0 = angle;
        const a1 = angle + frac * Math.PI * 2;
        angle = a1;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const x0 = cx + r * Math.cos(a0); const y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1); const y1 = cy + r * Math.sin(a1);
        let path;
        if (rInner > 0) {
            const ix0 = cx + rInner * Math.cos(a0); const iy0 = cy + rInner * Math.sin(a0);
            const ix1 = cx + rInner * Math.cos(a1); const iy1 = cy + rInner * Math.sin(a1);
            path = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${rInner} ${rInner} 0 ${large} 0 ${ix0} ${iy0} Z`;
        } else {
            path = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
        }
        return { path, color: PALETTE[i % PALETTE.length], d, frac };
    });
    return (
        <div className="flex flex-wrap items-center gap-6">
            <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img">
                {slices.map((s, i) => (
                    <path key={i} d={s.path} fill={s.color} stroke="var(--bg-primary)" strokeWidth="1.5">
                        <title>{`${s.d.label}: ${fmtNum(s.d.value)} (${Math.round(s.frac * 100)}%)`}</title>
                    </path>
                ))}
            </svg>
            <ul className="space-y-1 text-sm">
                {slices.map((s, i) => (
                    <li key={i} className="flex items-center gap-2">
                        <span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color }} />
                        <span className="text-[var(--text-secondary)]">{truncate(s.d.label, 22)}</span>
                        <span className="text-[var(--text-tertiary)]">· {fmtNum(s.d.value)} ({Math.round(s.frac * 100)}%)</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

const truncate = (s, n) => {
    const str = String(s ?? '');
    return str.length > n ? str.slice(0, n - 1) + '…' : str;
};

export default VaultChart;

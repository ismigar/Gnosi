import { formatNumber, toNumber, type ResolvedFieldFormat } from './model/formatUtils';

/** Shared numeric presentation; the stored value is never rescaled or clamped. */
export function NumberValue({ value, format }: { value: unknown; format: ResolvedFieldFormat }) {
    const numericValue = typeof value === 'string' && /^\s*-?\d+(?:[.,]\d+)?\s*%\s*$/.test(value) ? value.replace('%', '').trim() : value;
    const number = (typeof numericValue === 'number' || (typeof numericValue === 'string' && numericValue.trim())) ? toNumber(numericValue) : null;
    const graphical = format.display === 'bar' || format.display === 'ring';
    const maximum = format.progressMax && format.progressMax > 0 ? format.progressMax : 100;
    const percent = number === null ? null : number * 100 / (typeof value === 'string' && value.includes('%') ? 100 : maximum);
    const label = formatNumber(graphical && percent !== null ? percent : format.kind === 'percent' ? numericValue : value, { ...format, locale: format.numberLocale, kind: graphical ? 'percent' : format.kind });
    if (!graphical || number === null || !Number.isFinite(number)) return <span className="tabular-nums">{label}</span>;
    const bounded = Math.min(100, Math.max(0, percent ?? 0));
    return <span className="inline-flex max-w-full items-center gap-2 tabular-nums" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={bounded} aria-valuetext={label}>
        {format.display === 'ring'
            ? <svg aria-hidden="true" viewBox="0 0 36 36" className="h-6 w-6 shrink-0 -rotate-90"><circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--border-primary)" strokeWidth="4" /><circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--gnosi-primary)" strokeWidth="4" strokeDasharray={`${String(bounded)} 100`} /></svg>
            : <span aria-hidden="true" className="h-1.5 w-20 min-w-0 shrink overflow-hidden rounded-full bg-[var(--border-primary)]"><span className="block h-full rounded-full bg-[var(--gnosi-primary)]" style={{ width: `${String(bounded)}%` }} /></span>}
        <span className="shrink-0 whitespace-nowrap">{label}</span>
    </span>;
}

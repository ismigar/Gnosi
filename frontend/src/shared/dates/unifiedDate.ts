import { parsePeriod, type PeriodInput } from './projectPlanning';
import { formatVaultDate, parseVaultDate } from '../records/model/dateUtils';
import { formatDate } from '../records/model/formatUtils';

export interface UnifiedDateValue {
    [key: string]: unknown;
    version: 3;
    kind: 'point' | 'period';
    withTime: boolean;
    start: string;
    end: string;
}

/** Read legacy scalars, imported ranges and planning objects without dropping extensions. */
export function unifiedDate(value: unknown, legacyType = 'date'): UnifiedDateValue {
    const source = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Readonly<Record<string, unknown>> : {};
    const period = parsePeriod(value);
    const kind = period.kind ?? (legacyType === 'period' || period.end
        || (typeof value === 'string' && value.includes('/')) ? 'period' : 'point');
    return {
        startMode: 'manual', endMode: 'manual', mode: 'manual',
        ...source,
        version: 3,
        kind,
        withTime: period.withTime ?? (legacyType === 'datetime'
            || period.start.includes('T') || period.end.includes('T')),
        start: period.start,
        end: period.end,
    };
}

/** Hide the optional clock without destroying it, so toggling it back restores the time. */
export function dateBoundary(value: UnifiedDateValue, part: 'start' | 'end'): string {
    const raw = part === 'end' && value.kind === 'point' ? value.start : value[part];
    return value.withTime ? (/^-?\d{4,}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00` : raw)
        : raw.split('T')[0] ?? '';
}

export function dateDuration(value: UnifiedDateValue): number | null {
    if (value.kind !== 'period' || !value.start || !value.end) return null;
    const start = parseVaultDate(dateBoundary(value, 'start'));
    const end = parseVaultDate(dateBoundary(value, 'end'));
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return null;
    if (value.withTime) return (end.getTime() - start.getTime()) / 3_600_000;
    // Calendar days are inclusive and independent of daylight saving transitions.
    return Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate())
        - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86_400_000) + 1;
}

export function dateWithDuration(value: UnifiedDateValue, duration: number): UnifiedDateValue {
    const end = parseVaultDate(dateBoundary(value, 'start'));
    if (!value.start || !Number.isFinite(end.getTime()) || !Number.isFinite(duration)
        || duration < (value.withTime ? 0 : 1) || (!value.withTime && !Number.isInteger(duration))) return value;
    if (value.withTime) end.setTime(end.getTime() + duration * 3_600_000);
    else end.setDate(end.getDate() + duration - 1);
    return { ...value, end: formatVaultDate(end, { withTime: value.withTime }),
        startMode: 'manual', endMode: 'manual', mode: 'manual' };
}

export function unifiedDateInput(value: UnifiedDateValue): PeriodInput {
    return value;
}

export function formatUnifiedDate(value: unknown, options: {
    legacyType?: string; dateFormat?: string; locale?: string; pending?: string;
} = {}): string {
    const date = unifiedDate(value, options.legacyType);
    const format = (part: 'start' | 'end'): string => {
        const raw = dateBoundary(date, part);
        if (!raw) return options.pending ?? '…';
        const parsed = parseVaultDate(raw);
        return Number.isFinite(parsed.getTime()) ? formatDate(parsed, {
            dateFormat: options.dateFormat, locale: options.locale,
            type: date.withTime ? 'datetime' : 'date',
        }) : raw;
    };
    if (!date.start && !date.end) return '';
    return date.kind === 'period' ? `${format('start')} → ${format('end')}` : format('start');
}

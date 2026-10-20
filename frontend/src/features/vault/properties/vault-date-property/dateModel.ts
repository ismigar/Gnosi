import { parsePeriod } from '../../../../shared/dates/projectPlanning';
import {
    formatVaultDate,
    isSignedVaultDate,
    parseVaultDate,
} from '../../../../shared/records/model/dateUtils';
import type { PlanningScalar, VaultDatePropertyType } from './types';
import { formatDate } from '../../../../shared/records/model/formatUtils';

type ScalarDateValue = PlanningScalar | symbol | object;
function importedText(value: unknown): string { return String(value); }

function primitiveText(
    value: ScalarDateValue,
): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') {
        return String(value);
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return '';
}

export function addDaysISO(isoDate: string, days: number): string {
    const date = parseVaultDate(isoDate);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + days);
    return formatVaultDate(date);
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

export function toLocalDateString(
    date: Date,
    type: VaultDatePropertyType,
): string {
    const day = `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return type === 'datetime'
        ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`
        : day;
}

export function scalarDateValue(value: unknown): ScalarDateValue {
    if (value === null || value === undefined
        || typeof value === 'string' || typeof value === 'number'
        || typeof value === 'bigint' || typeof value === 'boolean'
        || typeof value === 'symbol' || typeof value === 'function') {
        return value;
    }
    return parsePeriod(value).start;
}

function parseableDateValue(
    value: ScalarDateValue,
): string | number | Date | null | undefined {
    if (typeof value === 'bigint' || typeof value === 'boolean') return primitiveText(value);
    if (value === null || value === undefined || typeof value === 'string' || typeof value === 'number') return value;
    // Match parseVaultDate's signed-date path before Date's ToPrimitive path.
    const text = importedText(value).trim();
    if (/^-?\d{4,}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?$/.test(text)) return text;
    const date: unknown = Reflect.construct(Date, [value]);
    if (!(date instanceof Date)) throw new TypeError('Invalid date constructor');
    return date;
}

export function isSignedDateValue(value: unknown): boolean {
    return isSignedVaultDate(importedText(scalarDateValue(value) ?? ''));
}

export function htmlDateValue(
    value: unknown,
    type: VaultDatePropertyType,
): string {
    const scalar = scalarDateValue(value);
    if (!scalar) return '';
    const date = parseVaultDate(parseableDateValue(scalar));
    if (Number.isNaN(date.getTime()) || date.getFullYear() < 0) return '';
    const datePart = `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    return type === 'datetime'
        ? `${datePart}T${pad(date.getHours())}:${pad(date.getMinutes())}`
        : datePart;
}

export function formattedDateInputValue(
    value: unknown,
    type: VaultDatePropertyType,
    dateLocale: string,
    dateFormat = 'locale',
): string {
    const scalar = scalarDateValue(value);
    if (!scalar) return '';
    try {
        const date = parseVaultDate(parseableDateValue(scalar));
        if (Number.isNaN(date.getTime())) return primitiveText(scalar);
        if (date.getFullYear() < 0) {
            return formatVaultDate(date, { withTime: type === 'datetime' });
        }
        if (dateFormat !== 'locale') return formatDate(date, { dateFormat, type, locale: dateLocale });
        const options: Intl.DateTimeFormatOptions = {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        };
        if (type === 'datetime') {
            options.hour = '2-digit';
            options.minute = '2-digit';
            options.hourCycle = 'h23';
        }
        return date.toLocaleString(dateLocale || 'en-US', options)
            .replace(',', '');
    } catch {
        return primitiveText(scalar);
    }
}

type DatePart = 'day' | 'month' | 'year';
function inputDateOrder(locale: string, format: string): DatePart[] {
    if (format === 'YYYY-MM-DD') return ['year', 'month', 'day'];
    if (format === 'MM/DD/YYYY') return ['month', 'day', 'year'];
    if (format === 'DD/MM/YYYY') return ['day', 'month', 'year'];
    return new Intl.DateTimeFormat(locale || 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })
        .formatToParts(new Date(2006, 10, 22)).flatMap(({ type }) => (
            type === 'day' || type === 'month' || type === 'year' ? [type] : []
        ));
}

/** Parse the exact numeric order used by the visible editor; reject invalid dates. */
export function dateInputBoundary(raw: string, type: VaultDatePropertyType, locale: string, format = 'locale'): string {
    const text = raw.trim();
    if (!text) return '';
    const iso = text.match(/^(-?\d{4,})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/);
    let year: number, month: number, day: number, hour = 0, minute = 0;
    if (iso) {
        [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
        hour = Number(iso[4] || 0); minute = Number(iso[5] || 0);
    } else {
        if (!/^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4}(?:\s+\d{1,2}:\d{2})?$/.test(text)) return '';
        const parts = text.match(/\d+/g) ?? [];
        const order = inputDateOrder(locale, format);
        if ((parts[order.indexOf('year')]?.length ?? 0) < 4) return '';
        const values = parts.map(Number);
        year = values[order.indexOf('year')] ?? NaN;
        month = values[order.indexOf('month')] ?? NaN;
        day = values[order.indexOf('day')] ?? NaN;
        hour = values[3] ?? 0; minute = values[4] ?? 0;
    }
    const date = new Date(0);
    date.setFullYear(year, month - 1, day); date.setHours(hour, minute, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day
        || date.getHours() !== hour || date.getMinutes() !== minute) return '';
    return formatVaultDate(date, { withTime: type === 'datetime' });
}

/** Translate pattern tokens and order them according to Settings or the language. */
export function dateInputPlaceholder(locale: string, format: string, template: string): string {
    const [dateTemplate = '', ...time] = template.split(/\s+/);
    const [day = 'DD', month = 'MM', year = 'YYYY'] = dateTemplate.split('/');
    const tokens = { day, month, year };
    const pattern = format === 'locale'
        ? new Intl.DateTimeFormat(locale || 'en-US', { day: '2-digit', month: '2-digit', year: 'numeric' })
            .formatToParts(new Date(2006, 10, 22)).map(part => (
                part.type === 'day' || part.type === 'month' || part.type === 'year' ? tokens[part.type] : part.value
            )).join('')
        : inputDateOrder(locale, format).map(part => tokens[part]).join(format === 'YYYY-MM-DD' ? '-' : '/');
    return [pattern, ...time].join(' ');
}

import { parsePeriod } from '../../../utils/projectPlanning';
import {
    formatVaultDate,
    isSignedVaultDate,
    parseVaultDate,
} from '../dateUtils';
import type { PlanningScalar, VaultDatePropertyType } from './types';

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
): string {
    const scalar = scalarDateValue(value);
    if (!scalar) return '';
    try {
        const date = parseVaultDate(parseableDateValue(scalar));
        if (Number.isNaN(date.getTime())) return primitiveText(scalar);
        if (date.getFullYear() < 0) {
            return formatVaultDate(date, { withTime: type === 'datetime' });
        }
        const options: Intl.DateTimeFormatOptions = {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        };
        if (type === 'datetime') {
            options.hour = '2-digit';
            options.minute = '2-digit';
        }
        return date.toLocaleString(dateLocale || 'en-US', options)
            .replace(',', '');
    } catch {
        return primitiveText(scalar);
    }
}

import type { PeriodInput } from '../../../utils/projectPlanning';
import { parsePeriod } from '../../../utils/projectPlanning';
import {
    formatVaultDate,
    isSignedVaultDate,
    parseVaultDate,
} from '../dateUtils';
import type { VaultDatePropertyType } from './types';

function primitiveText(
    value: string | number | bigint | boolean | null | undefined,
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

export function scalarDateValue(value: PeriodInput): string | number | bigint | boolean | null | undefined {
    if (value !== null && typeof value === 'object') {
        return parsePeriod(value).start;
    }
    return value;
}

function parseableDateValue(
    value: string | number | bigint | boolean | null | undefined,
): string | number | null | undefined {
    return typeof value === 'bigint' || typeof value === 'boolean'
        ? primitiveText(value)
        : value;
}

export function isSignedDateValue(value: PeriodInput): boolean {
    return isSignedVaultDate(parseableDateValue(scalarDateValue(value)));
}

export function htmlDateValue(
    value: PeriodInput,
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
    value: PeriodInput,
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

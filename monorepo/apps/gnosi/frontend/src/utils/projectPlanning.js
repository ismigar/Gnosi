/**
 * Pure scheduling helpers for the built-in project-planning plugin.
 *
 * Enhanced period values are structured objects. Legacy "start/end" strings
 * remain readable so vaults migrate one edited value at a time.
 */

const DEFAULT_SETTINGS = Object.freeze({
    hours_per_day: 8,
    workday_start: '09:00',
    working_weekdays: [1, 2, 3, 4, 5],
    holidays: [],
});

const pad = (value) => String(value).padStart(2, '0');

function parseLocalDateTime(value) {
    if (value instanceof Date) return new Date(value.getTime());
    const text = String(value || '').trim();
    const match = text.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (match) {
        return new Date(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3]),
            Number(match[4] || 0),
            Number(match[5] || 0),
            Number(match[6] || 0),
            0,
        );
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatLocalDateTime(value) {
    const date = parseLocalDateTime(value);
    if (!date) return '';
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function validDuration(value) {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizedIds(value) {
    const input = Array.isArray(value) ? value : (value ? [value] : []);
    return [...new Set(input.map((item) => String(item || '').trim()).filter(Boolean))];
}

export function parsePeriod(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return {
            version: 2,
            start: String(value.start || ''),
            end: String(value.end || ''),
            durationDays: validDuration(value.durationDays),
            predecessorIds: normalizedIds(value.predecessorIds),
            startMode: value.startMode === 'auto' ? 'auto' : 'manual',
            endMode: value.endMode === 'auto' ? 'auto' : 'manual',
        };
    }

    const [start = '', end = ''] = String(value || '').split('/');
    return {
        version: 1,
        start,
        end,
        durationDays: null,
        predecessorIds: [],
        startMode: 'manual',
        endMode: 'manual',
    };
}

export function serializePeriod(value) {
    const period = parsePeriod(value);
    if (
        !period.start
        && !period.end
        && period.durationDays === null
        && period.predecessorIds.length === 0
    ) {
        return '';
    }
    return {
        version: 2,
        start: period.start,
        end: period.end,
        durationDays: period.durationDays,
        predecessorIds: period.predecessorIds,
        startMode: period.startMode,
        endMode: period.endMode,
    };
}

export function withPeriodBoundaries(value, start, end, modes = {}) {
    const period = parsePeriod(value);
    period.start = String(start || '');
    period.end = String(end || '');
    if (modes.startMode === 'auto' || modes.startMode === 'manual') {
        period.startMode = modes.startMode;
    }
    if (modes.endMode === 'auto' || modes.endMode === 'manual') {
        period.endMode = modes.endMode;
    }
    return serializePeriod(period);
}

export function periodBoundary(value, part) {
    if (!part) return value;
    const period = parsePeriod(value);
    return part === 'end' ? (period.end || period.start) : period.start;
}

function normalizeSettings(settings = {}, skipNonWorkingDays = true) {
    const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    const startMatch = String(merged.workday_start || '').match(/^(\d{2}):(\d{2})$/);
    const startMinutes = startMatch
        ? Math.min(1439, Number(startMatch[1]) * 60 + Number(startMatch[2]))
        : 9 * 60;
    const requestedHours = Number(merged.hours_per_day);
    const maxHours = Math.max(0.25, (1440 - startMinutes) / 60);
    const hoursPerDay = Number.isFinite(requestedHours) && requestedHours > 0
        ? Math.min(requestedHours, maxHours)
        : DEFAULT_SETTINGS.hours_per_day;
    const requestedWeekdays = (Array.isArray(merged.working_weekdays)
        ? merged.working_weekdays
        : DEFAULT_SETTINGS.working_weekdays)
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
    const weekdays = skipNonWorkingDays
        ? new Set(
            requestedWeekdays.length > 0
                ? requestedWeekdays
                : DEFAULT_SETTINGS.working_weekdays,
        )
        : new Set([0, 1, 2, 3, 4, 5, 6]);
    const holidays = skipNonWorkingDays
        ? new Set(
            (Array.isArray(merged.holidays) ? merged.holidays : [])
                .map((day) => String(day || '').trim())
                .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)),
        )
        : new Set();
    return { hoursPerDay, startMinutes, weekdays, holidays };
}

function dayKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayWindow(date, calendar) {
    if (!calendar.weekdays.has(date.getDay()) || calendar.holidays.has(dayKey(date))) {
        return null;
    }
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setMinutes(calendar.startMinutes);
    const end = new Date(start.getTime() + calendar.hoursPerDay * 60 * 60 * 1000);
    return { start, end };
}

export function nextWorkingInstant(value, settings = {}, skipNonWorkingDays = true) {
    const parsed = parseLocalDateTime(value);
    if (!parsed) return '';
    const calendar = normalizeSettings(settings, skipNonWorkingDays);
    const cursor = new Date(parsed.getTime());

    for (let guard = 0; guard < 3700; guard += 1) {
        const window = dayWindow(cursor, calendar);
        if (window) {
            if (cursor < window.start) return formatLocalDateTime(window.start);
            if (cursor < window.end) return formatLocalDateTime(cursor);
        }
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
    }
    return '';
}

export function addWorkingDuration(
    startValue,
    durationDays,
    settings = {},
    skipNonWorkingDays = true,
) {
    const duration = validDuration(durationDays);
    if (duration === null) return '';
    const calendar = normalizeSettings(settings, skipNonWorkingDays);
    const normalizedStart = nextWorkingInstant(startValue, settings, skipNonWorkingDays);
    let cursor = parseLocalDateTime(normalizedStart);
    if (!cursor) return '';
    let remainingMinutes = duration * calendar.hoursPerDay * 60;
    if (remainingMinutes === 0) return formatLocalDateTime(cursor);

    for (let guard = 0; guard < 3700; guard += 1) {
        const window = dayWindow(cursor, calendar);
        if (!window) {
            const next = nextWorkingInstant(cursor, settings, skipNonWorkingDays);
            cursor = parseLocalDateTime(next);
            if (!cursor) return '';
            continue;
        }
        if (cursor < window.start) cursor = new Date(window.start.getTime());
        if (cursor >= window.end) {
            cursor.setDate(cursor.getDate() + 1);
            cursor.setHours(0, 0, 0, 0);
            const next = nextWorkingInstant(cursor, settings, skipNonWorkingDays);
            cursor = parseLocalDateTime(next);
            if (!cursor) return '';
            continue;
        }
        const availableMinutes = (window.end.getTime() - cursor.getTime()) / 60000;
        if (remainingMinutes <= availableMinutes) {
            cursor = new Date(cursor.getTime() + remainingMinutes * 60000);
            return formatLocalDateTime(cursor);
        }
        remainingMinutes -= availableMinutes;
        cursor.setDate(cursor.getDate() + 1);
        cursor.setHours(0, 0, 0, 0);
        const next = nextWorkingInstant(cursor, settings, skipNonWorkingDays);
        cursor = parseLocalDateTime(next);
        if (!cursor) return '';
    }
    return '';
}

export function workingDurationDays(
    startValue,
    endValue,
    settings = {},
    skipNonWorkingDays = true,
) {
    const start = parseLocalDateTime(startValue);
    const end = parseLocalDateTime(endValue);
    if (!start || !end || end < start) return null;
    const calendar = normalizeSettings(settings, skipNonWorkingDays);
    if (end.getTime() === start.getTime()) return 0;

    let minutes = 0;
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    for (let guard = 0; day <= lastDay && guard < 3700; guard += 1) {
        const window = dayWindow(day, calendar);
        if (window) {
            const overlapStart = Math.max(window.start.getTime(), start.getTime());
            const overlapEnd = Math.min(window.end.getTime(), end.getTime());
            if (overlapEnd > overlapStart) minutes += (overlapEnd - overlapStart) / 60000;
        }
        day.setDate(day.getDate() + 1);
    }
    return Number((minutes / (calendar.hoursPerDay * 60)).toFixed(4));
}

export function periodDaysInclusive(startOrValue, endValue) {
    if (
        startOrValue
        && typeof startOrValue === 'object'
        && !Array.isArray(startOrValue)
    ) {
        const period = parsePeriod(startOrValue);
        if (period.durationDays !== null) return period.durationDays;
        return periodDaysInclusive(period.start, period.end);
    }
    if (!startOrValue || !endValue) return null;
    const start = parseLocalDateTime(startOrValue);
    const end = parseLocalDateTime(endValue);
    if (!start || !end) return null;
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const diff = Math.round((endDay - startDay) / 86400000) + 1;
    return diff >= 1 ? diff : null;
}

export function latestPredecessorEnd(predecessorIds, notes, getPeriodValue) {
    let latest = null;
    for (const predecessorId of normalizedIds(predecessorIds)) {
        const note = (notes || []).find((candidate) => String(candidate.id) === predecessorId);
        if (!note) continue;
        const end = parseLocalDateTime(parsePeriod(getPeriodValue(note)).end);
        if (end && (!latest || end > latest)) latest = end;
    }
    return latest ? formatLocalDateTime(latest) : '';
}

export function dependencySuccessorIds(taskId, notes, getPredecessorIds) {
    const target = String(taskId || '');
    if (!target) return new Set();
    const successorsByPredecessor = new Map();
    for (const note of notes || []) {
        const noteId = String(note?.id || '');
        if (!noteId) continue;
        for (const predecessor of normalizedIds(getPredecessorIds(note))) {
            if (!successorsByPredecessor.has(predecessor)) {
                successorsByPredecessor.set(predecessor, []);
            }
            successorsByPredecessor.get(predecessor).push(noteId);
        }
    }
    const blocked = new Set([target]);
    const stack = [target];
    while (stack.length > 0) {
        const current = stack.pop();
        for (const successor of successorsByPredecessor.get(current) || []) {
            if (blocked.has(successor)) continue;
            blocked.add(successor);
            stack.push(successor);
        }
    }
    return blocked;
}

export function wouldCreateDependencyCycle(taskId, predecessorId, notes, getPredecessorIds) {
    const candidate = String(predecessorId || '');
    if (!candidate) return true;
    return dependencySuccessorIds(taskId, notes, getPredecessorIds).has(candidate);
}

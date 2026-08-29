/**
 * Pure scheduling helpers for the built-in project-planning plugin.
 *
 * Enhanced period values are structured objects. Legacy "start/end" strings
 * remain readable so vaults migrate one edited value at a time.
 */
type LegacyScalar = string | number | bigint | boolean | null | undefined;
export type PeriodUnit = 'hours' | 'days' | 'years';
type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
interface PlanningSettings { [key: string]: unknown; holidays?: readonly LegacyScalar[]; hours_per_day?: LegacyScalar; workday_start?: LegacyScalar; working_weekdays?: readonly LegacyScalar[]; }
type PlanningSettingsInput = PlanningSettings | null | undefined;
interface RawDependency { lagMinutes?: LegacyScalar; predecessorId?: LegacyScalar; type?: LegacyScalar; }
interface PeriodInputObject {
    actualEnd?: LegacyScalar; actualStart?: LegacyScalar; constraintDate?: LegacyScalar; constraintType?: LegacyScalar; deadline?: LegacyScalar; dependencies?: readonly RawDependency[]; durationDays?: LegacyScalar; durationUnit?: LegacyScalar; durationValue?: LegacyScalar; end?: LegacyScalar; endMode?: LegacyScalar; mode?: LegacyScalar; percentComplete?: LegacyScalar; predecessorIds?: LegacyScalar | readonly LegacyScalar[]; start?: LegacyScalar; startMode?: LegacyScalar;
}
export type PeriodInput = LegacyScalar | Date | PeriodInputObject;
interface NormalizedDependency { lagMinutes: number; predecessorId: string; type: DependencyType; }
interface ParsedPeriod {
    actualEnd: string; actualStart: string; constraintDate: string; constraintType: string; deadline: string; dependencies: NormalizedDependency[]; durationDays: number | null; durationUnit: PeriodUnit | null; durationValue: number | null; end: string; endMode: 'auto' | 'manual'; mode: 'automatic' | 'manual'; percentComplete: number; predecessorIds: string[]; start: string; startMode: 'auto' | 'manual'; version: 1 | 3;
}
interface SerializedPeriod extends Omit<ParsedPeriod, 'version'> { version: 3; }
interface BoundaryModes { endMode?: 'auto' | 'manual'; startMode?: 'auto' | 'manual'; }
interface NormalizedSettings { holidays: ReadonlySet<string>; hoursPerDay: number; startMinutes: number; weekdays: ReadonlySet<number>; }
interface IdentifiedNote { [key: string]: unknown; id?: LegacyScalar; }
const DEFAULT_SETTINGS = Object.freeze({
    hours_per_day: 8,
    workday_start: '09:00',
    working_weekdays: [1, 2, 3, 4, 5],
    holidays: [],
});
const PERIOD_UNITS: ReadonlySet<PeriodUnit> = new Set([
    'hours',
    'days',
    'years',
]);
const pad = (value: number): string => String(value).padStart(2, '0');
function isPeriodUnit(value: unknown): value is PeriodUnit {
    return value === 'hours' || value === 'days' || value === 'years';
}
function isLegacyScalarArray(value: LegacyScalar | readonly LegacyScalar[]): value is readonly LegacyScalar[] {
    return Array.isArray(value);
}
function isPeriodObject(value: PeriodInput): value is Date | PeriodInputObject {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value);
}
function parseLocalDateTime(value: Date | LegacyScalar): Date | null {
    if (value instanceof Date) return new Date(value.getTime());
    const text = String(value || '').trim();
    const match = text.match(
        /^(-?\d{4,})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/,
    );
    if (match) {
        // `new Date(year, ...)` remaps years 0–99 to 1900–1999. Set the year
        // explicitly so signed ISO dates and early CE dates retain their value.
        const date = new Date(0);
        date.setFullYear(
            Number(match[1]),
            Number(match[2]) - 1,
            Number(match[3]),
        );
        date.setHours(Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0), 0);
        return date;
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
export function formatLocalDateTime(value: Date | LegacyScalar): string {
    const date = parseLocalDateTime(value);
    if (!date) return '';
    const year = date.getFullYear();
    const formattedYear = year < 0 ? `-${String(Math.abs(year)).padStart(4, '0')}` : String(year).padStart(4, '0');
    return `${formattedYear}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function validDuration(value: LegacyScalar): number | null {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}
export function normalizePeriodUnit(value: unknown): PeriodUnit {
    return isPeriodUnit(value) ? value : 'days';
}
function configuredHoursPerDay(settings: PlanningSettingsInput = {}): number {
    const value = Number(settings?.hours_per_day);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTINGS.hours_per_day;
}
function normalizedIds(value: LegacyScalar | readonly LegacyScalar[] = []): string[] {
    const input = isLegacyScalarArray(value) ? value : (value ? [value] : []);
    return [...new Set(input.map((item) => String(item || '').trim()).filter(Boolean))];
}
function normalizedDependencies(value: readonly RawDependency[] | undefined,
    legacyIds: readonly string[] = []): NormalizedDependency[] {
    const input = value ?? [];
    const dependencies: readonly RawDependency[] = input.length > 0
        ? input
        : legacyIds.map((predecessorId): RawDependency => ({ predecessorId }));
    const seen = new Set<string>();
    const normalized: NormalizedDependency[] = [];
    dependencies.forEach((dependency) => {
        const predecessorId = String(dependency.predecessorId || '').trim();
        if (!predecessorId || seen.has(predecessorId)) return;
        seen.add(predecessorId);
        const rawType = String(dependency.type || '').toUpperCase();
        const type: DependencyType = rawType === 'SS' || rawType === 'FF'
            || rawType === 'SF' ? rawType : 'FS';
        const lagMinutes = Number(dependency.lagMinutes);
        normalized.push({
            predecessorId,
            type,
            lagMinutes: Number.isFinite(lagMinutes) ? lagMinutes : 0,
        });
    });
    return normalized;
}
export function parsePeriod(value: PeriodInput): ParsedPeriod {
    if (isPeriodObject(value)) {
        const source: PeriodInputObject = value instanceof Date ? {} : value;
        return {
            version: 3,
            start: String(source.start || ''),
            end: String(source.end || ''),
            durationDays: validDuration(source.durationDays),
            durationValue: validDuration(source.durationValue),
            durationUnit: isPeriodUnit(source.durationUnit)
                ? source.durationUnit : null,
            predecessorIds: normalizedIds(source.predecessorIds),
            dependencies: normalizedDependencies(
                source.dependencies,
                normalizedIds(source.predecessorIds),
            ),
            startMode: source.startMode === 'auto'
                || source.startMode === 'automatic' ? 'auto' : 'manual',
            endMode: source.endMode === 'auto'
                || source.endMode === 'automatic' ? 'auto' : 'manual',
            mode: source.mode === 'manual' ? 'manual' : 'automatic',
            constraintType: String(source.constraintType || 'ASAP').toUpperCase(),
            constraintDate: String(source.constraintDate || ''),
            deadline: String(source.deadline || ''),
            percentComplete: Math.min(100, Math.max(0, Number(source.percentComplete) || 0)),
            actualStart: String(source.actualStart || ''),
            actualEnd: String(source.actualEnd || ''),
        };
    }

    const [start = '', end = ''] = String(value || '').split('/');
    return {
        version: 1,
        start,
        end,
        durationDays: null,
        durationValue: null,
        durationUnit: null,
        predecessorIds: [],
        dependencies: [],
        startMode: 'manual',
        endMode: 'manual',
        mode: 'manual',
        constraintType: 'ASAP',
        constraintDate: '',
        deadline: '',
        percentComplete: 0,
        actualStart: '',
        actualEnd: '',
    };
}

export function serializePeriod(value: PeriodInput): '' | SerializedPeriod {
    const period = parsePeriod(value);
    if (
        !period.start
        && !period.end
        && period.durationDays === null
        && period.durationValue === null
        && period.dependencies.length === 0
    ) {
        return '';
    }
    return {
        version: 3,
        start: period.start,
        end: period.end,
        durationDays: period.durationDays,
        durationValue: period.durationValue,
        durationUnit: period.durationUnit,
        predecessorIds: period.dependencies.map((dependency) => dependency.predecessorId),
        dependencies: period.dependencies,
        startMode: period.startMode,
        endMode: period.endMode,
        mode: period.mode,
        constraintType: period.constraintType,
        constraintDate: period.constraintDate,
        deadline: period.deadline,
        percentComplete: period.percentComplete,
        actualStart: period.actualStart,
        actualEnd: period.actualEnd,
    };
}

export function withPeriodBoundaries(
    value: PeriodInput, start: LegacyScalar, end: LegacyScalar,
    modes: BoundaryModes = {},
): '' | SerializedPeriod {
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

export function periodBoundary(value: PeriodInput, part: string): string;
export function periodBoundary(value: PeriodInput, part?: null): PeriodInput;
export function periodBoundary(value: PeriodInput, part?: string | null): PeriodInput | string;
export function periodBoundary(value: PeriodInput,
    part?: string | null): PeriodInput | string {
    if (!part) return value;
    const period = parsePeriod(value);
    return part === 'end' ? (period.end || period.start) : period.start;
}

function normalizeSettings(settings: PlanningSettingsInput = {},
    skipNonWorkingDays = true): NormalizedSettings {
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
    const holidays: ReadonlySet<string> = skipNonWorkingDays
        ? new Set<string>(
            (settings?.holidays ?? [])
                .map((day) => String(day || '').trim())
                .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)),
        )
        : new Set<string>();
    return { hoursPerDay, startMinutes, weekdays, holidays };
}

function dayKey(date: Date): string {
    return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function dayWindow(date: Date,
    calendar: NormalizedSettings): { end: Date; start: Date } | null {
    if (!calendar.weekdays.has(date.getDay()) || calendar.holidays.has(dayKey(date))) {
        return null;
    }
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setMinutes(calendar.startMinutes);
    const end = new Date(start.getTime() + calendar.hoursPerDay * 60 * 60 * 1000);
    return { start, end };
}

export function nextWorkingInstant(value: Date | LegacyScalar,
    settings: PlanningSettingsInput = {}, skipNonWorkingDays = true): string {
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
    startValue: Date | LegacyScalar, durationDays: LegacyScalar,
    settings: PlanningSettingsInput = {}, skipNonWorkingDays = true,
): string {
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

/**
 * Converts the value shown by the period editor into the legacy working-day
 * duration used by the scheduler. The original field remains authoritative for
 * compatibility; durationValue/durationUnit retain the user's exact unit.
 */
export function periodDurationToWorkingDays(value: LegacyScalar, unit: unknown,
    settings: PlanningSettingsInput = {}): number | null {
    const duration = validDuration(value);
    if (duration === null) return null;
    const normalizedUnit = normalizePeriodUnit(unit);
    if (normalizedUnit === 'hours') return duration / configuredHoursPerDay(settings);
    if (normalizedUnit === 'years') return duration * 365;
    return duration;
}

/** Adds a duration using the configured unit, preserving calendar years. */
export function addPeriodDuration(
    startValue: Date | LegacyScalar, durationValue: LegacyScalar, unit: unknown,
    settings: PlanningSettingsInput = {}, skipNonWorkingDays = true,
): string {
    const duration = validDuration(durationValue);
    if (duration === null) return '';
    const normalizedUnit = normalizePeriodUnit(unit);
    if (normalizedUnit !== 'years') {
        return addWorkingDuration(
            startValue,
            periodDurationToWorkingDays(duration, normalizedUnit, settings),
            settings,
            skipNonWorkingDays,
        );
    }
    const start = parseLocalDateTime(startValue);
    if (!start) return '';
    const wholeYears = Math.trunc(duration);
    start.setFullYear(start.getFullYear() + wholeYears);
    const fractionalDays = (duration - wholeYears) * 365;
    if (fractionalDays) start.setDate(start.getDate() + fractionalDays);
    return formatLocalDateTime(start);
}

/** Derives a displayed duration from two period boundaries. */
export function periodDurationFromBoundaries(
    startValue: Date | LegacyScalar, endValue: Date | LegacyScalar, unit: unknown,
    settings: PlanningSettingsInput = {}, skipNonWorkingDays = true,
): number | null {
    const start = parseLocalDateTime(startValue);
    const end = parseLocalDateTime(endValue);
    if (!start || !end || end < start) return null;
    const normalizedUnit = normalizePeriodUnit(unit);
    if (normalizedUnit === 'years') {
        const wholeYears = end.getFullYear() - start.getFullYear();
        const anchor = new Date(start.getTime());
        anchor.setFullYear(start.getFullYear() + wholeYears);
        if (anchor.getTime() === end.getTime()) return wholeYears;
        return Number((wholeYears + (end.getTime() - anchor.getTime()) / (365 * 86400000)).toFixed(4));
    }
    const days = workingDurationDays(startValue, endValue, settings, skipNonWorkingDays);
    if (days === null) return null;
    return normalizedUnit === 'hours'
        ? Number((days * configuredHoursPerDay(settings)).toFixed(4))
        : days;
}

export function workingDurationDays(
    startValue: Date | LegacyScalar, endValue: Date | LegacyScalar,
    settings: PlanningSettingsInput = {}, skipNonWorkingDays = true,
): number | null {
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

export function periodDaysInclusive(startOrValue: PeriodInput,
    endValue?: Date | LegacyScalar): number | null {
    if (isPeriodObject(startOrValue)) {
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
    const diff = Math.round(
        (endDay.getTime() - startDay.getTime()) / 86400000,
    ) + 1;
    return diff >= 1 ? diff : null;
}

export function latestPredecessorEnd<T extends IdentifiedNote>(
    predecessorIds: LegacyScalar | readonly LegacyScalar[], notes: readonly T[] | null | undefined,
    getPeriodValue: (note: T) => PeriodInput): string {
    let latest: Date | null = null;
    for (const predecessorId of normalizedIds(predecessorIds)) {
        const note = (notes || []).find((candidate) => String(candidate.id) === predecessorId);
        if (!note) continue;
        const end = parseLocalDateTime(parsePeriod(getPeriodValue(note)).end);
        if (end && (!latest || end > latest)) latest = end;
    }
    return latest ? formatLocalDateTime(latest) : '';
}

export function dependencySuccessorIds<T extends IdentifiedNote>(
    taskId: LegacyScalar, notes: readonly T[] | null | undefined,
    getPredecessorIds: (note: T) => LegacyScalar | readonly LegacyScalar[],
): Set<string> {
    const target = String(taskId || '');
    if (!target) return new Set();
    const successorsByPredecessor = new Map<string, string[]>();
    for (const note of notes || []) {
        const noteId = String(note.id || '');
        if (!noteId) continue;
        for (const predecessor of normalizedIds(getPredecessorIds(note))) {
            if (!successorsByPredecessor.has(predecessor)) {
                successorsByPredecessor.set(predecessor, []);
            }
            successorsByPredecessor.get(predecessor)?.push(noteId);
        }
    }
    const blocked = new Set([target]);
    const stack = [target];
    while (stack.length > 0) {
        const current = stack.pop();
        if (current === undefined) break;
        for (const successor of successorsByPredecessor.get(current) || []) {
            if (blocked.has(successor)) continue;
            blocked.add(successor);
            stack.push(successor);
        }
    }
    return blocked;
}

export function wouldCreateDependencyCycle<T extends IdentifiedNote>(
    taskId: LegacyScalar, predecessorId: LegacyScalar,
    notes: readonly T[] | null | undefined,
    getPredecessorIds: (note: T) => LegacyScalar | readonly LegacyScalar[],
): boolean {
    const candidate = String(predecessorId || '');
    if (!candidate) return true;
    return dependencySuccessorIds(taskId, notes, getPredecessorIds).has(candidate);
}

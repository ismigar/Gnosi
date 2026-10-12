/** Backward-compatible values shared by date fields and project planning. */
export type LegacyScalar = string | number | bigint | boolean | null | undefined;
export type PeriodUnit = 'hours' | 'days' | 'years';
type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
interface RawDependency { lagMinutes?: LegacyScalar; predecessorId?: LegacyScalar; type?: LegacyScalar; }
interface PeriodInputObject {
    kind?: 'point' | 'period'; withTime?: boolean;
    actualEnd?: LegacyScalar; actualStart?: LegacyScalar; constraintDate?: LegacyScalar; constraintType?: LegacyScalar; deadline?: LegacyScalar; dependencies?: readonly RawDependency[]; durationDays?: LegacyScalar; durationUnit?: LegacyScalar; durationValue?: LegacyScalar; end?: LegacyScalar; endMode?: LegacyScalar; mode?: LegacyScalar; percentComplete?: LegacyScalar; predecessorIds?: LegacyScalar | readonly LegacyScalar[]; start?: LegacyScalar; startMode?: LegacyScalar;
}
export type PeriodInput = LegacyScalar | Date | PeriodInputObject;
interface NormalizedDependency { lagMinutes: number; predecessorId: string; type: DependencyType; }
interface ParsedPeriod {
    kind?: 'point' | 'period'; withTime?: boolean;
    actualEnd: string; actualStart: string; constraintDate: string; constraintType: string; deadline: string; dependencies: NormalizedDependency[]; durationDays: number | null; durationUnit: PeriodUnit | null; durationValue: number | null; end: string; endMode: 'auto' | 'manual'; mode: 'automatic' | 'manual'; percentComplete: number; predecessorIds: string[]; start: string; startMode: 'auto' | 'manual'; version: 1 | 3;
}
interface SerializedPeriod extends Omit<ParsedPeriod, 'version'> { version: 3; }
interface BoundaryModes { endMode?: 'auto' | 'manual'; startMode?: 'auto' | 'manual'; }

function importedText(value: unknown): string { return String(value); }

function isUnknownArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

function property(value: unknown, key: string): unknown {
    if (value === null || value === undefined) throw new TypeError(`Cannot read properties of ${String(value)} (reading '${key}')`);
    const boxed: unknown = Object(value);
    if ((typeof boxed === 'object' && boxed !== null) || typeof boxed === 'function') return Reflect.get(boxed, key);
    throw new TypeError('Expected a property receiver');
}

function callMethod(value: unknown, key: string, args: readonly unknown[]): unknown {
    const method = property(value, key);
    if (typeof method !== 'function') throw new TypeError(`${key} is not a function`);
    return Reflect.apply(method, value, args);
}

function isPeriodUnit(value: unknown): value is PeriodUnit {
    return value === 'hours' || value === 'days' || value === 'years';
}

export function isPeriodObject(value: unknown): value is Record<string, unknown> {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value);
}

export function validDuration(value: unknown): number | null {
    if (value === '' || value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizePeriodUnit(value: unknown): PeriodUnit {
    return isPeriodUnit(value) ? value : 'days';
}

export function normalizedIds(value: unknown = []): string[] {
    const input = isUnknownArray(value) ? value : (value ? [value] : []);
    return [...new Set(input.map((item) => importedText(item || '').trim()).filter(Boolean))];
}

function normalizedDependencies(value: unknown,
    legacyIds: readonly string[] = []): NormalizedDependency[] {
    const input = value ?? [];
    const dependencies = Number(property(input, 'length')) > 0
        ? input
        : legacyIds.map((predecessorId): RawDependency => ({ predecessorId }));
    const seen = new Set<string>();
    const normalized: NormalizedDependency[] = [];
    callMethod(dependencies, 'forEach', [(dependency: unknown) => {
        const predecessorId = importedText(property(dependency, 'predecessorId') || '').trim();
        if (!predecessorId || seen.has(predecessorId)) return;
        seen.add(predecessorId);
        const rawType = importedText(property(dependency, 'type') || '').toUpperCase();
        const type: DependencyType = rawType === 'SS' || rawType === 'FF'
            || rawType === 'SF' ? rawType : 'FS';
        const lagMinutes = Number(property(dependency, 'lagMinutes'));
        normalized.push({
            predecessorId,
            type,
            lagMinutes: Number.isFinite(lagMinutes) ? lagMinutes : 0,
        });
    }]);
    return normalized;
}

export function parsePeriod(value: unknown): ParsedPeriod {
    if (isPeriodObject(value)) {
        const source = value instanceof Date ? {} : value;
        return {
            ...(source.kind === 'point' || source.kind === 'period' ? { kind: source.kind } : {}),
            ...(typeof source.withTime === 'boolean' ? { withTime: source.withTime } : {}),
            version: 3,
            start: importedText(source.start || ''),
            end: importedText(source.end || ''),
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
            constraintType: importedText(source.constraintType || 'ASAP').toUpperCase(),
            constraintDate: importedText(source.constraintDate || ''),
            deadline: importedText(source.deadline || ''),
            percentComplete: Math.min(100, Math.max(0, Number(source.percentComplete) || 0)),
            actualStart: importedText(source.actualStart || ''),
            actualEnd: importedText(source.actualEnd || ''),
        };
    }
    const [start = '', end = ''] = importedText(value || '').split('/');
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
        !period.kind
        &&
        !period.start
        && !period.end
        && period.durationDays === null
        && period.durationValue === null
        && period.dependencies.length === 0
    ) {
        return '';
    }
    return {
        ...(period.kind ? { kind: period.kind } : {}),
        ...(period.withTime !== undefined ? { withTime: period.withTime } : {}),
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
    value: unknown, start: LegacyScalar, end: LegacyScalar,
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

export function periodBoundary<T>(value: T, part?: null | ''): T;
export function periodBoundary(value: unknown, part: string): string;
export function periodBoundary<T>(value: T, part?: string | null): T | string;
export function periodBoundary<T>(value: T,
    part?: string | null): T | string {
    if (!part) return value;
    const period = parsePeriod(value);
    const boundary = part === 'end' && period.kind !== 'point'
        ? (period.end || period.start) : period.start;
    return period.withTime === false ? boundary.split('T')[0] ?? '' : boundary;
}

import type { TFunction } from 'i18next';

import {
    addPeriodDuration,
    addWorkingDuration,
    dependencySuccessorIds,
    formatLocalDateTime,
    latestPredecessorEnd,
    nextWorkingInstant,
    normalizePeriodUnit,
    parsePeriod,
    periodDaysInclusive,
    periodDurationFromBoundaries,
    periodDurationToWorkingDays,
    serializePeriod,
    type PeriodUnit,
} from '../../../../shared/dates/projectPlanning';
import type {
    PeriodEditorProps,
    PlanningScalar,
    VaultPlanningNote,
} from './types';

export type ParsedPeriod = ReturnType<typeof parsePeriod>;
export type PeriodDependency = ParsedPeriod['dependencies'][number];
export type ConstraintType = 'ASAP' | 'ALAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';
export type PeriodDateKind = 'start' | 'end' | 'actual_start' | 'actual_end' | 'constraint_date' | 'deadline';

export const PLANNING_CONSTRAINT_OPTIONS: readonly Readonly<[
    ConstraintType,
    string,
]>[] = [
    ['ASAP', 'vault_date.period_constraint_option_asap'],
    ['ALAP', 'vault_date.period_constraint_option_alap'],
    ['SNET', 'vault_date.period_constraint_option_snet'],
    ['SNLT', 'vault_date.period_constraint_option_snlt'],
    ['FNET', 'vault_date.period_constraint_option_fnet'],
    ['FNLT', 'vault_date.period_constraint_option_fnlt'],
    ['MSO', 'vault_date.period_constraint_option_mso'],
    ['MFO', 'vault_date.period_constraint_option_mfo'],
];

const CONSTRAINTS_REQUIRING_DATE: ReadonlySet<string> = new Set([
    'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO',
]);

export const PERIOD_INPUT_CLASS = 'w-full h-9 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none transition focus:border-[var(--gnosi-primary)]/50 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20';

function scalarText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return '';
}

function isPlanningScalarArray(value: unknown): value is readonly PlanningScalar[] {
    return Array.isArray(value) && value.every((item: unknown) => (
        item === null
        || item === undefined
        || typeof item === 'string'
        || typeof item === 'number'
        || typeof item === 'bigint'
        || typeof item === 'boolean'
    ));
}

function periodMetadataValue(value: unknown): unknown {
    return isPlanningScalarArray(value) ? '' : (value ?? '');
}

function metadataScalarText(value: unknown): string {
    if (isPlanningScalarArray(value)) return '';
    if (value !== null && typeof value === 'object') return '';
    return scalarText(value);
}

function settingsRecord(value: unknown): value is Record<string, unknown> {
    return (typeof value === 'object' && value !== null) || typeof value === 'function';
}

function dependencyType(value: string): PeriodDependency['type'] {
    return value === 'SS' || value === 'FF' || value === 'SF' ? value : 'FS';
}

export interface PlanningPeriodModel {
    readonly candidates: readonly VaultPlanningNote[];
    readonly commitConstraintDate: (value: string) => void;
    readonly commitDeadline: (value: string) => void;
    readonly constraintRequiresDate: boolean;
    readonly displayDuration: number | '';
    readonly duration: number | null;
    readonly handleDependencyLagChange: (index: number, value: string) => void;
    readonly handleDependencyTypeChange: (index: number, value: string) => void;
    readonly handleDurationChange: (value: string) => void;
    readonly handleEndChange: (value: string) => void;
    readonly handleStartChange: (value: string) => void;
    readonly hasPredecessors: boolean;
    readonly period: ParsedPeriod;
    readonly periodInputToBoundary: (value: string) => string;
    readonly periodInputValue: (value: string, isEnd?: boolean) => string;
    readonly periodUnit: PeriodUnit;
    readonly predecessorsEnabled: boolean;
    readonly selectedConstraintType: string;
    readonly selectedPredecessors: readonly Readonly<{ id: string; title: string }>[];
    readonly setConstraintType: (value: string) => void;
    readonly skipNonWorkingDays: boolean;
    readonly summaryDuration: string;
    readonly summaryEnd: string;
    readonly summaryStart: string;
    readonly togglePredecessor: (id: string) => void;
}

export function periodDateLabel(
    t: TFunction,
    periodUnit: PeriodUnit,
    kind: PeriodDateKind,
): string {
    const defaults: Record<PeriodUnit, Record<PeriodDateKind, string>> = {
        hours: {
            start: 'Start date and time', end: 'Finish date and time',
            actual_start: 'Actual start', actual_end: 'Actual finish',
            constraint_date: 'Constraint date and time',
            deadline: 'Deadline date and time',
        },
        days: {
            start: 'Start date', end: 'Finish date', actual_start: 'Actual start date',
            actual_end: 'Actual finish date', constraint_date: 'Constraint date',
            deadline: 'Deadline date',
        },
        years: {
            start: 'Start year', end: 'Finish year', actual_start: 'Actual start year',
            actual_end: 'Actual finish year', constraint_date: 'Constraint year',
            deadline: 'Deadline year',
        },
    };
    return t(`vault_date.period_${kind}_${periodUnit}`, defaults[periodUnit][kind]);
}

export function createPlanningPeriodModel({
    fieldConfig,
    fieldName,
    idToTitle,
    noteId,
    notes,
    onChange,
    planningSettings: settingsInput,
    value,
}: PeriodEditorProps, dateLocale: string): PlanningPeriodModel {
    const period = parsePeriod(value);
    const periodUnit = normalizePeriodUnit(fieldConfig.period_unit);
    const predecessorsEnabled = fieldConfig.predecessors_enabled !== false;
    const skipNonWorkingDays = fieldConfig.skip_non_working_days !== false;
    // Keep the original object (including inherited fields and extensions).
    // Property access on null/undefined previously failed here as well.
    if (settingsInput === null || settingsInput === undefined) {
        throw new TypeError(`Cannot read properties of ${String(settingsInput)} (reading 'workday_start')`);
    }
    const planningSettings: unknown = Object(settingsInput);
    if (!settingsRecord(planningSettings)) throw new TypeError('Invalid planning settings receiver');
    const workdayStart = /^\d{2}:\d{2}$/.test(scalarText(planningSettings.workday_start))
        ? scalarText(planningSettings.workday_start)
        : '09:00';
    const asInputDateTime = (raw: string, isEnd = false): string => {
        if (!raw) return '';
        if (raw.includes('T')) return formatLocalDateTime(raw);
        if (!/^-?\d{4,}-\d{2}-\d{2}$/.test(raw)) return formatLocalDateTime(raw);
        if (!isEnd) return `${raw}T${workdayStart}`;
        const startOfDay = `${raw}T${workdayStart}`;
        return addWorkingDuration(startOfDay, 1, planningSettings, false)
            || startOfDay;
    };
    const periodInputValue = (raw: string, isEnd = false): string => {
        const dateTime = asInputDateTime(raw, isEnd);
        if (!dateTime) return '';
        if (periodUnit === 'hours') return dateTime;
        if (periodUnit === 'days') return dateTime.slice(0, 10);
        return dateTime.match(/^-?\d{4,}/)?.[0] ?? '';
    };
    const periodInputToBoundary = (raw: string): string => {
        if (!raw) return '';
        if (periodUnit === 'hours') return raw;
        if (periodUnit === 'days') return `${raw}T${workdayStart}`;
        if (!/^-?\d+$/.test(raw)) return '';
        const numericYear = Number(raw);
        if (!Number.isInteger(numericYear)) return '';
        const year = numericYear < 0
            ? `-${String(Math.abs(numericYear)).padStart(4, '0')}`
            : String(numericYear).padStart(4, '0');
        return `${year}-01-01T${workdayStart}`;
    };
    const displayStart = asInputDateTime(period.start);
    const displayEnd = asInputDateTime(period.end, true);
    const legacyDuration = period.durationDays === null
        ? null
        : periodUnit === 'hours'
            ? period.durationDays * (Number(planningSettings.hours_per_day) || 8)
            : periodUnit === 'years' ? period.durationDays / 365 : period.durationDays;
    const duration = period.durationValue !== null
        && (!period.durationUnit || period.durationUnit === periodUnit)
        ? period.durationValue
        : periodDurationFromBoundaries(
            displayStart, displayEnd, periodUnit, planningSettings, skipNonWorkingDays,
        ) ?? legacyDuration ?? periodDaysInclusive(period.start, period.end);
    const displayDuration = duration === null
        ? ''
        : Number(duration.toFixed(4));
    const durationValueFor = (candidate: ParsedPeriod): number | null => {
        if (candidate.durationValue !== null
            && (!candidate.durationUnit || candidate.durationUnit === periodUnit)) {
            return candidate.durationValue;
        }
        if (candidate.durationDays === null) return null;
        if (periodUnit === 'hours') {
            return candidate.durationDays * (Number(planningSettings.hours_per_day) || 8);
        }
        return periodUnit === 'years'
            ? candidate.durationDays / 365
            : candidate.durationDays;
    };
    const taskTableId = scalarText(planningSettings.task_table_id);
    const getTableId = (note: VaultPlanningNote | undefined): string => (
        scalarText(note?.resolved_table_id)
        || metadataScalarText(note?.metadata?.table_id)
        || metadataScalarText(note?.metadata?.database_table_id)
    );
    const currentNote = notes.find((note) => note.id === noteId);
    const scopedTableId = getTableId(currentNote) || taskTableId;
    const scopedNotes = notes.filter((note) => (
        scopedTableId ? getTableId(note) === scopedTableId : false
    ));
    const periodKeys = [fieldName, fieldConfig.id, ...(fieldConfig.aliases ?? [])]
        .filter((key): key is string => Boolean(key));
    const getPeriodValue = (note: VaultPlanningNote): unknown => {
        const metadata = note.metadata ?? {};
        const key = periodKeys.find((candidate) => Object.hasOwn(metadata, candidate));
        return key ? periodMetadataValue(metadata[key]) : '';
    };
    const getPredecessorIds = (note: VaultPlanningNote): readonly string[] => {
        const parsed = parsePeriod(getPeriodValue(note));
        if (parsed.version >= 2) return parsed.predecessorIds;
        const legacy = note.metadata?.predecessor_ids;
        return isPlanningScalarArray(legacy)
            ? legacy.map(scalarText).filter(Boolean)
            : [];
    };
    const blocked = dependencySuccessorIds(noteId, scopedNotes, getPredecessorIds);
    const candidates = scopedNotes.filter((note) => !blocked.has(note.id));
    const commit = (next: ParsedPeriod): void => {
        onChange(serializePeriod(next));
    };
    const fillAutomaticBoundaries = (
        next: ParsedPeriod,
        recalculateStart = false,
    ): ParsedPeriod => {
        if (predecessorsEnabled
            && next.predecessorIds.length > 0
            && (!next.start || (next.startMode === 'auto' && recalculateStart))) {
            const predecessorEnd = latestPredecessorEnd(
                next.predecessorIds, scopedNotes, getPeriodValue,
            );
            next.start = predecessorEnd
                ? nextWorkingInstant(predecessorEnd, planningSettings, skipNonWorkingDays)
                : next.start;
            if (next.start) next.startMode = 'auto';
        }
        const nextDuration = durationValueFor(next);
        if (next.start && nextDuration !== null) {
            next.end = addPeriodDuration(
                next.start, nextDuration, periodUnit,
                planningSettings, skipNonWorkingDays,
            );
            if (next.end) next.endMode = 'auto';
        }
        return next;
    };
    const handleStartChange = (newStart: string): void => {
        const next = { ...period, start: newStart, startMode: 'manual' as const };
        if (duration !== null) {
            next.durationValue = duration;
            next.durationUnit = periodUnit;
            next.durationDays = periodDurationToWorkingDays(duration, periodUnit, planningSettings);
            next.end = addPeriodDuration(
                newStart, duration, periodUnit, planningSettings, skipNonWorkingDays,
            );
            next.endMode = 'auto';
        } else if (newStart && displayEnd) {
            next.durationValue = periodDurationFromBoundaries(
                newStart, displayEnd, periodUnit, planningSettings, skipNonWorkingDays,
            );
            next.durationUnit = periodUnit;
            next.durationDays = periodDurationToWorkingDays(
                next.durationValue, periodUnit, planningSettings,
            );
        }
        commit(next);
    };
    const handleEndChange = (newEnd: string): void => {
        const next = { ...period, end: newEnd, endMode: 'manual' as const };
        if (displayStart && newEnd) {
            next.durationValue = periodDurationFromBoundaries(
                displayStart, newEnd, periodUnit, planningSettings, skipNonWorkingDays,
            );
            next.durationUnit = periodUnit;
            next.durationDays = periodDurationToWorkingDays(
                next.durationValue, periodUnit, planningSettings,
            );
        }
        commit(next);
    };
    const handleDurationChange = (raw: string): void => {
        const nextDuration = raw === '' ? null : Number(raw);
        if (nextDuration !== null && (!Number.isFinite(nextDuration) || nextDuration < 0)) return;
        const next = {
            ...period,
            durationValue: nextDuration,
            durationUnit: periodUnit,
            durationDays: periodDurationToWorkingDays(nextDuration, periodUnit, planningSettings),
            endMode: 'auto' as const,
        };
        if (!next.start) fillAutomaticBoundaries(next, true);
        if (next.start && nextDuration !== null) {
            next.end = addPeriodDuration(
                asInputDateTime(next.start), nextDuration, periodUnit,
                planningSettings, skipNonWorkingDays,
            );
        } else if (nextDuration === null) {
            next.end = '';
        }
        commit(next);
    };
    const handlePredecessorsChange = (predecessorIds: string[]): void => {
        const next: ParsedPeriod = {
            ...period,
            predecessorIds,
            dependencies: predecessorIds.map((predecessorId) => (
                period.dependencies.find((item) => item.predecessorId === predecessorId)
                ?? { predecessorId, type: 'FS', lagMinutes: 0 }
            )),
        };
        if (predecessorIds.length === 0 && next.startMode === 'auto') {
            next.start = '';
            if (next.endMode === 'auto') next.end = '';
        } else if (predecessorIds.length > 0) {
            next.start = '';
            next.startMode = 'auto';
            next.end = '';
            next.endMode = 'auto';
            if (duration !== null && durationValueFor(next) === null) {
                next.durationValue = duration;
                next.durationUnit = periodUnit;
                next.durationDays = periodDurationToWorkingDays(
                    duration, periodUnit, planningSettings,
                );
            }
            fillAutomaticBoundaries(next, true);
        }
        commit(next);
    };
    const selectedPredecessors = period.predecessorIds.map((id) => ({
        id,
        title: idToTitle[id] || id,
    }));
    const summaryStart = periodInputValue(period.start);
    const summaryEnd = periodInputValue(period.end, true);
    const summaryDuration = displayDuration === '' ? '' : new Intl.NumberFormat(
        dateLocale || 'en-US',
        {
            style: 'unit',
            unit: periodUnit === 'hours' ? 'hour' : periodUnit === 'years' ? 'year' : 'day',
            unitDisplay: 'long',
            maximumFractionDigits: 4,
        },
    ).format(displayDuration);

    return {
        candidates,
        commitConstraintDate: (constraintDate) => {
            commit({ ...period, constraintDate });
        },
        commitDeadline: (deadline) => {
            commit({ ...period, deadline });
        },
        constraintRequiresDate: CONSTRAINTS_REQUIRING_DATE.has(period.constraintType || 'ASAP'),
        displayDuration,
        duration,
        handleDependencyLagChange: (index, lag) => {
            commit({
                ...period,
                dependencies: period.dependencies.map((item, itemIndex) => itemIndex === index
                    ? { ...item, lagMinutes: Number(lag) || 0 }
                    : item),
            });
        },
        handleDependencyTypeChange: (index, type) => {
            commit({
                ...period,
                dependencies: period.dependencies.map((item, itemIndex) => itemIndex === index
                    ? { ...item, type: dependencyType(type) }
                    : item),
            });
        },
        handleDurationChange,
        handleEndChange,
        handleStartChange,
        hasPredecessors: predecessorsEnabled && selectedPredecessors.length > 0,
        period,
        periodInputToBoundary,
        periodInputValue,
        periodUnit,
        predecessorsEnabled,
        selectedConstraintType: period.constraintType || 'ASAP',
        selectedPredecessors,
        setConstraintType: (constraintType) => {
            commit({ ...period, constraintType });
        },
        skipNonWorkingDays,
        summaryDuration,
        summaryEnd,
        summaryStart,
        togglePredecessor: (id) => {
            handlePredecessorsChange(
                period.predecessorIds.includes(id)
                    ? period.predecessorIds.filter((candidate) => candidate !== id)
                    : [...period.predecessorIds, id],
            );
        },
    };
}

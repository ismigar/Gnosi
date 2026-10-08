import {
    formatLocalDateTime,
    nextWorkingInstant,
    parsePeriod,
    periodDurationFromBoundaries,
    serializePeriod,
    withPeriodBoundaries,
    workingDurationDays,
} from '../../dates/projectPlanning';

import type {
    TimelineChartNote,
    TimelineNote,
    TimelineRecord,
    TimelineSchema,
    TimelineSchemaReaders,
    TimelineUnit,
} from './types';


type PlanningSettings = NonNullable<Parameters<typeof nextWorkingInstant>[1]>;

export interface SchedulingOptions {
    readonly chartData: readonly TimelineChartNote[];
    readonly dateField: string | undefined;
    readonly endDateField: string | undefined;
    readonly enhancedPeriod: boolean;
    readonly notes: readonly TimelineNote[];
    readonly onUpdateNote: ((id: string, patch: { readonly metadata: Readonly<Record<string, unknown>> }) => unknown) | undefined;
    readonly predecessorField?: string;
    readonly planningSettings: PlanningSettings;
    readonly predecessors: (note: TimelineRecord) => readonly string[];
    readonly readers: TimelineSchemaReaders;
    readonly schema: TimelineSchema;
    readonly skipNonWorkingDays: boolean;
    readonly timelineUnit: TimelineUnit;
}


export function dateValue(note: TimelineRecord, dateField: string | undefined): unknown {
    return dateField ? note.metadata?.[dateField] ?? '' : '';
}


function pad(value: number): string {
    return String(value).padStart(2, '0');
}


function formatDay(date: Date): string {
    return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}


function formatForField(
    date: Date,
    field: string,
    schema: TimelineSchema,
    readers: TimelineSchemaReaders,
): string {
    return readers.fieldType(schema, field) === 'datetime'
        ? `${formatDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
        : formatDay(date);
}


export function buildDateMetadata(
    target: TimelineRecord,
    start: Date,
    end: Date,
    options: Omit<SchedulingOptions, 'chartData' | 'notes' | 'onUpdateNote' | 'predecessors'>,
): Readonly<Record<string, unknown>> {
    const {
        dateField,
        endDateField,
        enhancedPeriod,
        planningSettings,
        readers,
        schema,
        skipNonWorkingDays,
        timelineUnit,
    } = options;
    const metadata: Record<string, unknown> = {};
    if (dateField) {
        if (readers.fieldType(schema, dateField) === 'period') {
            if (enhancedPeriod) {
                const next = parsePeriod(withPeriodBoundaries(
                    dateValue(target, dateField),
                    formatLocalDateTime(start),
                    formatLocalDateTime(end),
                    { startMode: 'manual', endMode: 'manual' },
                ));
                next.durationValue = periodDurationFromBoundaries(
                    next.start,
                    next.end,
                    timelineUnit,
                    planningSettings,
                    skipNonWorkingDays,
                );
                next.durationUnit = timelineUnit;
                next.durationDays = workingDurationDays(
                    next.start,
                    next.end,
                    planningSettings,
                    skipNonWorkingDays,
                );
                metadata[dateField] = serializePeriod(next);
            } else {
                metadata[dateField] = `${formatDay(start)}/${formatDay(end)}`;
            }
        } else {
            metadata[dateField] = formatForField(start, dateField, schema, readers);
        }
    }
    if (endDateField && readers.fieldType(schema, endDateField) !== 'period') {
        metadata[endDateField] = formatForField(end, endDateField, schema, readers);
    }
    return metadata;
}

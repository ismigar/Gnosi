import { useCallback } from 'react';

import { logError } from '../../../lib/notifyError';
import {
    addPeriodDuration,
    formatLocalDateTime,
    nextWorkingInstant,
    parsePeriod,
    periodDurationFromBoundaries,
    serializePeriod,
    withPeriodBoundaries,
    workingDurationDays,
} from '../../../utils/projectPlanning';

import type {
    TimelineChartNote,
    TimelineNote,
    TimelinePatch,
    TimelineRecord,
    TimelineSchema,
    TimelineSchemaReaders,
    TimelineUnit,
} from './types';


type PlanningSettings = NonNullable<Parameters<typeof nextWorkingInstant>[1]>;
type UpdateNote = (noteId: string, patch: TimelinePatch) => unknown;


interface SchedulingOptions {
    readonly chartData: readonly TimelineChartNote[];
    readonly dateField: string | undefined;
    readonly endDateField: string | undefined;
    readonly enhancedPeriod: boolean;
    readonly notes: readonly TimelineNote[];
    readonly onUpdateNote: UpdateNote | undefined;
    readonly planningSettings: PlanningSettings;
    readonly predecessors: (note: TimelineRecord) => readonly string[];
    readonly readers: TimelineSchemaReaders;
    readonly schema: TimelineSchema;
    readonly skipNonWorkingDays: boolean;
    readonly timelineUnit: TimelineUnit;
}


interface SchedulingController {
    readonly addPredecessor: (
        noteId: string,
        predecessorId: string,
    ) => Promise<void>;
}


function dateValue(note: TimelineRecord, dateField: string | undefined): unknown {
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


function buildDateMetadata(
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


function recalculateSuccessors(
    updatedNoteId: string,
    newEnd: Date,
    allNotes: readonly TimelineChartNote[],
    options: SchedulingOptions,
    visited = new Set([updatedNoteId]),
): TimelineChartNote[] {
    const affected: TimelineChartNote[] = [];
    if (!allNotes.some((note) => note.id === updatedNoteId)) return affected;
    const successors = allNotes.filter(
        (note) => options.predecessors(note).includes(updatedNoteId),
    );
    for (const successor of successors) {
        if (visited.has(successor.id)) continue;
        const normalizedStart = options.enhancedPeriod
            ? nextWorkingInstant(
                formatLocalDateTime(newEnd),
                options.planningSettings,
                options.skipNonWorkingDays,
            )
            : newEnd;
        const minimumStart = new Date(normalizedStart);
        if (successor.start >= minimumStart) continue;
        const nextStart = new Date(minimumStart);
        const period = parsePeriod(dateValue(successor, options.dateField));
        const duration = period.durationValue ?? period.durationDays;
        const unit = period.durationValue !== null
            ? period.durationUnit ?? options.timelineUnit
            : 'days';
        const scheduledEnd = options.enhancedPeriod && duration !== null
            ? addPeriodDuration(
                normalizedStart,
                duration,
                unit,
                options.planningSettings,
                options.skipNonWorkingDays,
            )
            : '';
        const nextEnd = scheduledEnd
            ? new Date(scheduledEnd)
            : new Date(
                minimumStart.getTime()
                + successor.end.getTime()
                - successor.start.getTime(),
            );
        const updated = { ...successor, start: nextStart, end: nextEnd };
        affected.push(updated);
        visited.add(successor.id);
        const updatedCollection = allNotes.map(
            (note) => note.id === successor.id ? updated : note,
        );
        affected.push(...recalculateSuccessors(
            successor.id,
            nextEnd,
            updatedCollection,
            options,
            visited,
        ));
    }
    return Array.from(
        new Map(affected.map((note) => [note.id, note])).values(),
    );
}


export function useTimelineScheduling(
    options: SchedulingOptions,
): SchedulingController {
    const updateDates = useCallback(async (
        noteId: string,
        newStart: Date,
        newEnd: Date,
    ): Promise<void> => {
        if (!options.onUpdateNote) return;
        const root = options.chartData.find((note) => note.id === noteId);
        if (!root) return;
        const successors = recalculateSuccessors(
            noteId,
            newEnd,
            options.chartData,
            options,
        );
        try {
            await options.onUpdateNote(noteId, {
                metadata: buildDateMetadata(root, newStart, newEnd, options),
            });
            for (const successor of successors) {
                await options.onUpdateNote(successor.id, {
                    metadata: buildDateMetadata(
                        successor,
                        successor.start,
                        successor.end,
                        options,
                    ),
                });
            }
        } catch (error) {
            logError('timeline-date-update', error);
        }
    }, [options]);

    const addPredecessor = useCallback(async (
        noteId: string,
        predecessorId: string,
    ): Promise<void> => {
        const note = options.notes.find((candidate) => candidate.id === noteId);
        if (!note || !options.onUpdateNote) return;
        const predecessorIds = [...options.predecessors(note)];
        if (predecessorIds.includes(predecessorId)) return;
        predecessorIds.push(predecessorId);
        const predecessor = options.chartData.find(
            (candidate) => candidate.id === predecessorId,
        );
        const current = options.chartData.find((candidate) => candidate.id === noteId);
        if (options.enhancedPeriod && options.dateField) {
            const next = parsePeriod(dateValue(note, options.dateField));
            next.predecessorIds = predecessorIds;
            if (predecessor) {
                next.start = nextWorkingInstant(
                    formatLocalDateTime(predecessor.end),
                    options.planningSettings,
                    options.skipNonWorkingDays,
                );
                next.startMode = 'auto';
                const duration = next.durationValue ?? next.durationDays;
                const unit = next.durationValue !== null
                    ? next.durationUnit ?? options.timelineUnit
                    : 'days';
                if (duration !== null) {
                    next.end = addPeriodDuration(
                        next.start,
                        duration,
                        unit,
                        options.planningSettings,
                        options.skipNonWorkingDays,
                    );
                    next.endMode = 'auto';
                }
            }
            await options.onUpdateNote(noteId, {
                metadata: { [options.dateField]: serializePeriod(next) },
            });
            return;
        }
        await options.onUpdateNote(noteId, {
            metadata: { ...note.metadata, predecessor_ids: predecessorIds },
        });
        if (predecessor && current && current.start < predecessor.end) {
            const duration = current.end.getTime() - current.start.getTime();
            const start = new Date(predecessor.end);
            const end = new Date(start.getTime() + duration);
            await updateDates(noteId, start, end);
        }
    }, [options, updateDates]);

    return { addPredecessor };
}


export function planningSettingsFrom(value: unknown): PlanningSettings {
    return isPlanningSettings(value) ? value : {};
}


function isPlanningSettings(value: unknown): value is PlanningSettings {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

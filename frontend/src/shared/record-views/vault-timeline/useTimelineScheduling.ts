import { useCallback, useRef, useState } from 'react';
import { addPeriodDuration, formatLocalDateTime, nextWorkingInstant, parsePeriod, serializePeriod } from '../../dates/projectPlanning';
import { predecessorCandidates } from './timelineModel';
import { buildDateMetadata, dateValue, type SchedulingOptions } from './schedulingModel';
import type { TimelineChartNote, TimelinePatch } from './types';

interface Save { readonly id: string; readonly patch: TimelinePatch; readonly before: TimelinePatch; }

function moveEnd(note: TimelineChartNote, start: Date, options: SchedulingOptions): Date {
    const period = parsePeriod(dateValue(note, options.dateField));
    const duration = period.durationValue ?? period.durationDays;
    if (options.enhancedPeriod && duration !== null) {
        return new Date(addPeriodDuration(formatLocalDateTime(start), duration,
            period.durationValue !== null ? period.durationUnit ?? options.timelineUnit : 'days',
            options.planningSettings, options.skipNonWorkingDays));
    }
    if (options.timelineUnit === 'days') {
        const days = (Date.UTC(note.end.getFullYear(), note.end.getMonth(), note.end.getDate())
            - Date.UTC(note.start.getFullYear(), note.start.getMonth(), note.start.getDate())) / 86400000;
        const end = new Date(start);
        end.setDate(end.getDate() + days);
        return end;
    }
    return new Date(start.getTime() + note.end.getTime() - note.start.getTime());
}

function minimumStart(note: TimelineChartNote, collection: ReadonlyMap<string, TimelineChartNote>, options: SchedulingOptions): Date | null {
    const ends = options.predecessors(note).flatMap(id => {
        const predecessor = collection.get(id);
        return predecessor?.hasDates !== false && predecessor ? [predecessor.end.getTime()] : [];
    });
    if (!ends.length) return null;
    const end = new Date(Math.max(...ends));
    return options.enhancedPeriod ? new Date(nextWorkingInstant(formatLocalDateTime(end), options.planningSettings, options.skipNonWorkingDays)) : end;
}

/** Relax the whole dependency graph, including records hidden by view filters. */
function schedule(root: TimelineChartNote, options: SchedulingOptions): TimelineChartNote[] {
    const collection = new Map(options.chartData.map(note => [note.id, note]));
    collection.set(root.id, root);
    const minimum = minimumStart(root, collection, options);
    if (minimum && root.start < minimum) {
        root = { ...root, start: minimum, end: moveEnd(root, minimum, options) };
        collection.set(root.id, root);
    }
    const changed = new Map([[root.id, root]]);
    const queue = [root.id];
    for (let guard = 0; queue.length && guard <= options.chartData.length ** 2; guard += 1) {
        const id = queue.shift();
        for (const note of collection.values()) {
            if (!id || note.id === root.id || note.hasDates === false || !options.predecessors(note).includes(id)) continue;
            const start = minimumStart(note, collection, options);
            if (!start || note.start >= start) continue;
            const updated = { ...note, start, end: moveEnd(note, start, options) };
            collection.set(note.id, updated);
            changed.set(note.id, updated);
            queue.push(note.id);
        }
    }
    if (queue.length) throw new Error('timeline.dependency_cycle');
    return [...changed.values()];
}

export function useTimelineScheduling(options: SchedulingOptions) {
    const [history, setHistory] = useState<readonly (readonly Save[])[]>([]);
    const [saving, setSaving] = useState(false);
    const lock = useRef(false);
    const saveBatch = useCallback(async (changes: readonly { readonly id: string; readonly metadata: Readonly<Record<string, unknown>> }[], remember = true) => {
        if (!options.onUpdateNote || lock.current) return;
        lock.current = true;
        setSaving(true);
        const saves: Save[] = changes.map(change => {
            const note = options.notes.find(candidate => candidate.id === change.id);
            const before = Object.fromEntries(Object.keys(change.metadata).filter(key => change.metadata[key] !== note?.metadata?.[key]).map(key => [key, note?.metadata?.[key] ?? null]));
            return { id: change.id, patch: { metadata: change.metadata }, before: { metadata: before } };
        });
        const completed: Save[] = [];
        try {
            for (const save of saves) { await options.onUpdateNote(save.id, save.patch); completed.push(save); }
            if (remember && saves.length) setHistory(current => [...current.slice(-19), saves]);
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            for (const saved of completed.reverse()) {
                try { await options.onUpdateNote(saved.id, saved.before); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
            }
            if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], 'timeline.partial_save', { cause: error });
            throw error;
        } finally { lock.current = false; setSaving(false); }
    }, [options]);
    const updateDates = useCallback(async (id: string, start: Date, end: Date) => {
        const note = options.chartData.find(candidate => candidate.id === id);
        if (!note || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return;
        const updated = schedule({ ...note, start, end, hasDates: true }, options);
        await saveBatch(updated.map(target => ({ id: target.id, metadata: buildDateMetadata(target, target.start, target.end, options) })));
    }, [options, saveBatch]);
    const addPredecessor = useCallback(async (id: string, predecessorId: string) => {
        const note = options.notes.find(candidate => candidate.id === id);
        if (!note || !options.onUpdateNote || options.predecessors(note).includes(predecessorId)) return;
        if (id === predecessorId || (options.chartData.some(candidate => candidate.id === predecessorId)
            && !predecessorCandidates(id, options.chartData, options.predecessors).some(candidate => candidate.id === predecessorId))) {
            throw new Error('timeline.dependency_cycle');
        }
        const metadata: Record<string, unknown> = {};
        if (options.enhancedPeriod && options.dateField) {
            const period = parsePeriod(dateValue(note, options.dateField));
            period.dependencies.push({ predecessorId, type: 'FS', lagMinutes: 0 });
            period.predecessorIds.push(predecessorId);
            metadata[options.dateField] = serializePeriod(period);
        } else metadata[options.predecessorField ?? 'predecessor_ids'] = [...options.predecessors(note), predecessorId];
        const current = options.chartData.find(candidate => candidate.id === id);
        const changes = current && current.hasDates !== false ? schedule({ ...current, metadata: { ...note.metadata, ...metadata } }, options)
            .map(target => ({ id: target.id, metadata: { ...(target.id === id ? note.metadata : {}), ...buildDateMetadata(target, target.start, target.end, options),
                ...(target.id === id && !options.enhancedPeriod ? metadata : {}) } }))
            : [{ id, metadata }];
        await saveBatch(changes);
    }, [options, saveBatch]);
    const undo = useCallback(async () => {
        const last = history.at(-1);
        if (!last || lock.current) return;
        await saveBatch([...last].reverse().map(save => ({ id: save.id, metadata: save.before.metadata })), false);
        setHistory(current => current.slice(0, -1));
    }, [history, saveBatch]);
    return { addPredecessor, updateDates, undo, canUndo: history.length > 0, saving };
}

export function planningSettingsFrom(value: unknown): SchedulingOptions['planningSettings'] {
    return isPlanningSettings(value) ? value : {};
}

function isPlanningSettings(value: unknown): value is SchedulingOptions['planningSettings'] {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { formatVaultDate, parseVaultDate } from '../dateUtils';
import { normalizeOptions, optionColorHex } from '../optionCatalogUtils';
import { parsePeriod, type PeriodInput } from '../../../utils/projectPlanning';
import type { FilterValue } from '../../../utils/vaultFilters';

import type {
    TimelineChartModel,
    TimelineChartNote,
    TimelineFieldConfig,
    TimelineNote,
    TimelineRecord,
    TimelineSchema,
    TimelineSchemaReaders,
    TimelineUnit,
} from './types';


const DAY_MS = 24 * 60 * 60 * 1000;
const PARENT_FIELD_ALIASES = new Set([
    'itemprincipal', 'parentitem', 'parent', 'pare', 'mare',
    'tascamare', 'tareapadre', 'tascaprincipal', 'tareaprincipal', 'parenttask',
]);


function stringifyLegacy(value: unknown): string {
    return Reflect.apply(String, undefined, [value]);
}


function foldKey(value: unknown): string {
    return stringifyLegacy(value ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
}


function asPeriodInput(value: FilterValue): PeriodInput {
    return value as PeriodInput;
}


function isFilterValueArray(value: FilterValue): value is readonly FilterValue[] {
    return Array.isArray(value);
}


export function timelineUnitFromConfig(
    config: TimelineFieldConfig,
): TimelineUnit {
    const unit = config.period_unit;
    return unit === 'hours' || unit === 'years' ? unit : 'days';
}


export function resolveTimelineDateFields(
    schema: TimelineSchema,
    dateField: string | undefined,
    endDateField: string | undefined,
    readers: TimelineSchemaReaders,
): { readonly dateField?: string; readonly endDateField?: string } {
    const names = readers.fieldNames(schema);
    const resolvedDate = dateField && names.includes(dateField)
        ? dateField
        : readers.fieldEntries(schema).find(([, type]) => type === 'date')?.[0]
            ?? readers.fieldEntries(schema).find(
                ([, type]) => type === 'datetime' || type === 'period',
            )?.[0];
    const endKeys = ['due_date', 'end_date', 'data de venciment', 'venciment'];
    const dateLike = ['date', 'datetime', 'period'];
    const resolvedEnd = endDateField && names.includes(endDateField)
        ? endDateField
        : names.find((field) => (
            endKeys.includes(field.toLowerCase())
            && dateLike.includes(readers.fieldType(schema, field))
        ));
    return { dateField: resolvedDate, endDateField: resolvedEnd };
}


export function predecessorsFor(
    note: TimelineRecord,
    enhancedPeriod: boolean,
    dateField: string | undefined,
): readonly string[] {
    if (enhancedPeriod && dateField) {
        const value = note.metadata?.[dateField] ?? '';
        const period = parsePeriod(asPeriodInput(value));
        if (period.version >= 2) return period.predecessorIds;
    }
    const value = note.metadata?.predecessor_ids;
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => typeof entry === 'string' ? entry : '')
        .filter(Boolean);
}


export function buildTimelineTicks(
    start: Date,
    end: Date,
    unit: TimelineUnit,
) {
    const ticks: { at: Date; label: string }[] = [];
    if (unit === 'years') {
        const firstYear = start.getFullYear();
        const lastYear = end.getFullYear() + 1;
        const step = Math.max(1, Math.ceil((lastYear - firstYear) / 12));
        for (let year = firstYear; year <= lastYear; year += step) {
            const tick = new Date(0);
            tick.setFullYear(year, 0, 1);
            ticks.push({
                at: tick,
                label: year < 0 ? `${String(Math.abs(year))} BCE` : String(year),
            });
        }
        return ticks;
    }
    const span = Math.max(1, end.getTime() - start.getTime());
    const nominal = unit === 'hours' ? 60 * 60 * 1000 : DAY_MS;
    const step = Math.max(nominal, Math.ceil(span / 12 / nominal) * nominal);
    for (let offset = 0; offset <= span + step; offset += step) {
        const at = new Date(start.getTime() + offset);
        ticks.push({
            at,
            label: formatVaultDate(at, { withTime: unit === 'hours' }),
        });
    }
    return ticks;
}


function resolveParentId(
    note: TimelineRecord,
    schema: TimelineSchema,
    readers: TimelineSchemaReaders,
): string | null {
    const metadata = note.metadata ?? {};
    const direct = metadata.parent_id
        || note.parent_id
        || metadata.source_parent_id;
    if (direct) return stringifyLegacy(direct);
    for (const [field, type] of readers.fieldEntries(schema)) {
        if (type !== 'relation' || !PARENT_FIELD_ALIASES.has(foldKey(field))) {
            continue;
        }
        const value = metadata[field];
        const first = isFilterValueArray(value) ? value[0] : value;
        if (first) return stringifyLegacy(first);
    }
    return null;
}


function normalizedMetadataKey(value: unknown): string {
    return stringifyLegacy(value).toLowerCase().replace(/[^a-z0-9]/gi, '');
}


function dateRangeForNote(
    note: TimelineNote,
    schema: TimelineSchema,
    dateField: string | undefined,
    endDateField: string | undefined,
    readers: TimelineSchemaReaders,
): { readonly end: Date; readonly start: Date } | null {
    let startValue: FilterValue = note.last_modified;
    let endValue: FilterValue = null;
    if (dateField) {
        const aliases: Readonly<Record<string, string>> = {
            dateadded: 'created_time',
            datemodified: 'last_edited_time',
        };
        const schemaKey = normalizedMetadataKey(dateField);
        const targetKey = normalizedMetadataKey(aliases[schemaKey] ?? schemaKey);
        const metadataKey = Object.keys(note.metadata ?? {}).find(
            (key) => normalizedMetadataKey(key) === targetKey,
        ) ?? dateField;
        const rawStart = note.metadata?.[metadataKey];
        if (readers.fieldType(schema, dateField) === 'period') {
            const period = parsePeriod(asPeriodInput(rawStart));
            if (period.start && !Number.isNaN(parseVaultDate(period.start).getTime())) {
                startValue = period.start;
            }
            if (period.end && !Number.isNaN(parseVaultDate(period.end).getTime())) {
                endValue = period.end;
            }
        } else {
            if (rawStart && !Number.isNaN(parseVaultDateValue(rawStart).getTime())) {
                startValue = rawStart;
            }
            const rawEnd = endDateField ? note.metadata?.[endDateField] : undefined;
            if (endDateField && rawEnd) {
                const endType = readers.fieldType(schema, endDateField);
                const period = endType === 'period'
                    ? parsePeriod(asPeriodInput(rawEnd))
                    : null;
                endValue = period ? period.end || period.start : rawEnd;
            }
        }
    }
    const start = parseVaultDateValue(startValue);
    if (Number.isNaN(start.getTime())) return null;
    let end = endValue
        ? parseVaultDateValue(endValue)
        : new Date(start.getTime() + DAY_MS);
    if (Number.isNaN(end.getTime()) || end < start) {
        end = new Date(start.getTime() + DAY_MS);
    }
    return { start, end };
}


function parseVaultDateValue(value: FilterValue): Date {
    if (
        typeof value === 'string'
        || typeof value === 'number'
        || value === null
        || value === undefined
    ) {
        return parseVaultDate(value);
    }
    return parseVaultDate(stringifyLegacy(value));
}


function addHierarchy(
    processedNotes: readonly TimelineChartNote[],
    schema: TimelineSchema,
    readers: TimelineSchemaReaders,
    hasExplicitSorts: boolean,
): TimelineChartNote[] {
    const byId = new Map(processedNotes.map((note) => [note.id, note]));
    const children = new Map<string, TimelineChartNote[]>();
    const roots: TimelineChartNote[] = [];
    for (const note of processedNotes) {
        const parentId = resolveParentId(note, schema, readers);
        if (parentId && parentId !== note.id && byId.has(parentId)) {
            const siblings = children.get(parentId) ?? [];
            siblings.push(note);
            children.set(parentId, siblings);
        } else roots.push(note);
    }

    const summarized = new Map<string, TimelineChartNote>();
    const summarize = (note: TimelineChartNote, seen: Set<string>) => {
        if (seen.has(note.id)) return { start: note.start, end: note.end };
        seen.add(note.id);
        let start = note.start;
        let end = note.end;
        const descendants = children.get(note.id) ?? [];
        for (const child of descendants) {
            const span = summarize(child, seen);
            if (span.start < start) start = span.start;
            if (span.end > end) end = span.end;
        }
        summarized.set(note.id, {
            ...note,
            isParent: descendants.length > 0,
            summaryEnd: end,
            summaryStart: start,
        });
        return { start, end };
    };
    for (const root of roots) summarize(root, new Set());

    const orderedRoots = hasExplicitSorts ? roots : [...roots].sort((first, second) => {
        const firstStart = summarized.get(first.id)?.summaryStart ?? first.start;
        const secondStart = summarized.get(second.id)?.summaryStart ?? second.start;
        return firstStart.getTime() - secondStart.getTime();
    });
    const flat: TimelineChartNote[] = [];
    const seen = new Set<string>();
    const pushTree = (note: TimelineChartNote, depth: number): void => {
        if (seen.has(note.id)) return;
        seen.add(note.id);
        flat.push({ ...(summarized.get(note.id) ?? note), depth });
        const descendants = [...(children.get(note.id) ?? [])]
            .sort((first, second) => first.start.getTime() - second.start.getTime());
        for (const child of descendants) pushTree(child, depth + 1);
    };
    for (const root of orderedRoots) pushTree(root, 0);
    return flat;
}


export function buildTimelineChart({
    dateField,
    endDateField,
    hasExplicitSorts,
    notes,
    readers,
    schema,
    timelineUnit,
}: {
    readonly dateField: string | undefined;
    readonly endDateField: string | undefined;
    readonly hasExplicitSorts: boolean;
    readonly notes: readonly TimelineNote[];
    readonly readers: TimelineSchemaReaders;
    readonly schema: TimelineSchema;
    readonly timelineUnit: TimelineUnit;
}): TimelineChartModel {
    const processed = notes.flatMap((note) => {
        const range = dateRangeForNote(note, schema, dateField, endDateField, readers);
        return range ? [{ ...note, ...range, depth: 0 }] : [];
    });
    if (processed.length === 0) return { chartData: [], timeScale: null };
    const minDate = new Date(Math.min(...processed.map(({ start }) => start.getTime())));
    const maxDate = new Date(Math.max(...processed.map(({ end }) => end.getTime())));
    const chartEnd = new Date(maxDate.getTime());
    const padding = timelineUnit === 'hours' ? 60 * 60 * 1000
        : timelineUnit === 'days' ? DAY_MS : 365 * DAY_MS;
    chartEnd.setTime(chartEnd.getTime() + padding);
    return {
        chartData: addHierarchy(processed, schema, readers, hasExplicitSorts),
        timeScale: {
            end: chartEnd,
            start: minDate,
            ticks: buildTimelineTicks(minDate, chartEnd, timelineUnit),
        },
    };
}


export function buildBarColorResolver(
    schema: TimelineSchema,
    colorField: string,
    readers: TimelineSchemaReaders,
): (note: TimelineChartNote) => string {
    if (!colorField) return () => 'var(--gnosi-primary)';
    const options = readers.fieldConfig(schema, colorField).options;
    const colorMap = new Map(
        (Array.isArray(options) ? normalizeOptions(options) : [])
            .map((option) => [option.name, optionColorHex(option.color)]),
    );
    return (note) => {
        const value = note.metadata?.[colorField];
        return typeof value === 'string' && colorMap.has(value)
            ? colorMap.get(value) ?? 'var(--gnosi-primary)'
            : 'var(--gnosi-primary)';
    };
}


export function timelinePosition(
    date: Date,
    start: Date,
    end: Date,
): number {
    return ((date.getTime() - start.getTime())
        / (end.getTime() - start.getTime())) * 100;
}


export function predecessorCandidates(
    rootId: string | null,
    notes: readonly TimelineChartNote[],
    predecessors: (note: TimelineRecord) => readonly string[],
): TimelineChartNote[] {
    if (!rootId) return [];
    const excluded = new Set<string>();
    const stack = [rootId];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        for (const note of notes) {
            if (!excluded.has(note.id) && predecessors(note).includes(current)) {
                excluded.add(note.id);
                stack.push(note.id);
            }
        }
    }
    return notes.filter((note) => note.id !== rootId && !excluded.has(note.id));
}

import { logError } from '../../notifications/notifyError';
import { planTimelineMove, timelineMoveTarget, type TimelineMove, type TimelinePlacement } from './timelineMoves';
import { useCallback, useId, useMemo, useRef, useState } from 'react';

import { useLocaleSettings } from '../../i18n/useLocaleSettings';
import { useVaultSelection } from '../../records/hooks/useVaultSelection';
import { useVaultSelectionShortcuts } from '../../records/hooks/useVaultSelectionShortcuts';
import {
    useVaultViewData,
    type VaultViewConfig,
} from '../../records/hooks/useVaultViewData';
import { usePlugins } from '../../plugins/usePlugins';
import { requireFilterNodes } from '../../filtering/filterContracts';
import { formatDate, resolveFieldFormat } from '../../records/model/formatUtils';
import {
    getFieldConfig,
    getFieldType,
    getSchemaFieldEntries,
    getSchemaFieldNames,
    resolveViewFilters,
    resolveViewSorts,
} from '../../records/model/schemaUtils';
import { useTitlePreview } from '../../editor/useTitlePreview';

import {
    buildBarColorResolver,
    buildTimelineChart,
    predecessorCandidates,
    resolveParentId,
    predecessorsFor,
    resolveTimelineDateFields,
    timelinePosition,
    timelineUnitFromConfig,
} from './timelineModel';
import {
    planningSettingsFrom,
    useTimelineScheduling,
} from './useTimelineScheduling';
import type {
    TimelineController,
    TimelineRecord,
    TimelineSchemaReaders,
    TimelineZoom,
    VaultTimelineProps,
} from './types';


const readers: TimelineSchemaReaders = {
    fieldConfig: (schema, field) => getFieldConfig(schema, String(field)),
    fieldEntries: getSchemaFieldEntries,
    fieldNames: getSchemaFieldNames,
    fieldType: (schema, field) => getFieldType(schema, String(field)),
    filters: (view) => requireFilterNodes(resolveViewFilters(view)),
    sorts: resolveViewSorts,
};


export function useVaultTimelineController({
    activeView = {},
    notes = [],
    onDeletePage,
    onDeleteSelected,
    onNoteSelect,
    onUpdateNote,
    schema = {},
    searchTerm: externalSearchTerm,
}: VaultTimelineProps): TimelineController {
    const { isEnabled, getPluginSettings } = usePlugins();
    const localeSettings = useLocaleSettings();
    const scrollContainerId = useId();
    const [zoomLevel, setZoomLevel] = useState<TimelineZoom>('month');
    const [selectingPredecessorFor, setSelectingPredecessorFor] = useState<
        string | null
    >(null);
    const [internalSearchTerm, setInternalSearchTerm] = useState('');
    const searchTerm = externalSearchTerm ?? internalSearchTerm;
    const setSearchTerm = externalSearchTerm === undefined
        ? setInternalSearchTerm
        : (): void => undefined;
    const hasExplicitSorts = useMemo(
        () => readers.sorts(activeView).length > 0,
        [activeView],
    );
    const view = useMemo<VaultViewConfig>(() => ({
        filters: readers.filters(activeView),
        search: searchTerm,
        sorts: readers.sorts(activeView, {
            field: 'last_modified',
            direction: 'desc',
        }),
    }), [activeView, searchTerm]);
    const { sortedPages } = useVaultViewData({
        pages: notes,
        schema,
        view,
        searchTerm,
    });
    const sortedNotes = sortedPages;
    const selection = useVaultSelection(sortedNotes);
    const titlePreview = useTitlePreview({ onOpenPage: onNoteSelect });

    const handleBulkDelete = useCallback((): void => {
        if (selection.selectedIds.size === 0) return;
        if (onDeleteSelected) {
            onDeleteSelected(new Set(selection.selectedIds));
            selection.clearSelection();
            return;
        }
        if (onDeletePage) {
            for (const id of selection.selectedIds) {
                const note = notes.find((candidate) => candidate.id === id);
                if (note) onDeletePage(id, note.title);
            }
            selection.clearSelection();
        }
    }, [notes, onDeletePage, onDeleteSelected, selection]);

    useVaultSelectionShortcuts({
        selectAll: selection.selectAll,
        clearSelection: selection.clearSelection,
        onDeleteSelected: handleBulkDelete,
    });

    const { dateField, endDateField } = useMemo(() => resolveTimelineDateFields(
        schema,
        activeView.dateField,
        activeView.endDateField,
        readers,
    ), [activeView.dateField, activeView.endDateField, schema]);
    const fieldConfig = readers.fieldConfig(schema, dateField);
    const timelineUnit = timelineUnitFromConfig(fieldConfig);
    const enhancedPeriod = isEnabled('project-planning')
        && readers.fieldType(schema, dateField) === 'period';
    const planningSettings = planningSettingsFrom(
        getPluginSettings('project-planning'),
    );
    const skipNonWorkingDays = fieldConfig.skip_non_working_days !== false;
    const getPredecessors = useCallback(
        (note: TimelineRecord) => predecessorsFor(note, enhancedPeriod, dateField),
        [dateField, enhancedPeriod],
    );
    const chart = useMemo(() => buildTimelineChart({
        dateField,
        endDateField,
        hasExplicitSorts,
        notes: sortedNotes,
        readers,
        schema,
        timelineUnit,
    }), [
        dateField,
        endDateField,
        hasExplicitSorts,
        schema,
        sortedNotes,
        timelineUnit,
    ]);
    const [movingRow, setMovingRow] = useState(false);
    const [moveError, setMoveError] = useState(false);
    const moveLock = useRef(false);
    const moveNotes = useMemo(() => {
        const all = buildTimelineChart({ dateField, endDateField, hasExplicitSorts,
            notes, readers, schema, timelineUnit }).chartData;
        const included = new Set(all.map(note => note.id));
        return [...all, ...notes.filter(note => !included.has(note.id))];
    }, [dateField, endDateField, hasExplicitSorts, notes, schema, timelineUnit]);
    const parentOf = useCallback((note: TimelineRecord) => resolveParentId(note, schema, readers), [schema]);
    const canMoveRow = useCallback((id: string, action?: TimelineMove) => (
        Boolean(onUpdateNote) && !hasExplicitSorts && !movingRow
        && (!action || Boolean(timelineMoveTarget(moveNotes, parentOf, id, action)))
    ), [onUpdateNote, hasExplicitSorts, movingRow, moveNotes, parentOf]);
    const dropRow = useCallback(async (id: string, targetId: string, placement: TimelinePlacement) => {
        if (!onUpdateNote || hasExplicitSorts || moveLock.current) return;
        const changes = planTimelineMove(moveNotes, parentOf, id, targetId, placement);
        if (!changes.length) return;
        moveLock.current = true;
        setMovingRow(true);
        setMoveError(false);
        try {
            for (const change of changes) await onUpdateNote(change.id, change.patch);
        } catch (error) {
            setMoveError(true);
            logError('timeline-row-move', error);
        } finally {
            moveLock.current = false;
            setMovingRow(false);
        }
    }, [onUpdateNote, hasExplicitSorts, moveNotes, parentOf]);
    const moveRow = useCallback(async (id: string, action: TimelineMove) => {
        const target = timelineMoveTarget(moveNotes, parentOf, id, action);
        if (target) await dropRow(id, target.id, target.placement);
    }, [moveNotes, parentOf, dropRow]);
    const scheduleOptions = useMemo(() => ({
        chartData: chart.chartData,
        dateField,
        endDateField,
        enhancedPeriod,
        notes,
        onUpdateNote,
        planningSettings,
        predecessors: getPredecessors,
        readers,
        schema,
        skipNonWorkingDays,
        timelineUnit,
    }), [
        chart.chartData,
        dateField,
        endDateField,
        enhancedPeriod,
        getPredecessors,
        notes,
        onUpdateNote,
        planningSettings,
        schema,
        skipNonWorkingDays,
        timelineUnit,
    ]);
    const scheduling = useTimelineScheduling(scheduleOptions);
    const handleAddPredecessor = useCallback(async (
        noteId: string,
        predecessorId: string,
    ): Promise<void> => {
        await scheduling.addPredecessor(noteId, predecessorId);
        setSelectingPredecessorFor(null);
    }, [scheduling]);

    const fieldFormat = useMemo(
        () => resolveFieldFormat(fieldConfig, localeSettings),
        [fieldConfig, localeSettings],
    );
    const formatTimelineDate = useCallback((date: Date): string => formatDate(
        date,
        {
            dateFormat: fieldFormat.dateFormat,
            type: 'date',
            locale: fieldFormat.dateLocale,
        },
    ), [fieldFormat]);
    const getBarColor = useMemo(
        () => buildBarColorResolver(schema, activeView.colorField ?? '', readers),
        [activeView.colorField, schema],
    );
    const calculatePosition = useCallback((date: Date): number => (
        chart.timeScale
            ? timelinePosition(date, chart.timeScale.start, chart.timeScale.end)
            : 0
    ), [chart.timeScale]);
    const candidates = useMemo(() => predecessorCandidates(
        selectingPredecessorFor,
        chart.chartData,
        getPredecessors,
    ), [chart.chartData, getPredecessors, selectingPredecessorFor]);
    const scroll = useCallback((direction: 'left' | 'right'): void => {
        document.getElementById(scrollContainerId)?.scrollBy({
            left: direction === 'left' ? -300 : 300,
            behavior: 'smooth',
        });
    }, [scrollContainerId]);
    const scaleMinWidth = timelineUnit === 'hours' ? '12000px'
        : timelineUnit === 'years' ? '1800px'
            : zoomLevel === 'day' ? '12000px'
                : zoomLevel === 'week' ? '6000px' : '3000px';

    return {
        movingRow, moveError, canMoveRow, moveRow, dropRow,
        activeFiltersCount: readers.filters(activeView).length,
        activeSortsCount: readers.sorts(activeView).length,
        calculatePosition,
        chartData: chart.chartData,
        clearSelection: selection.clearSelection,
        externalSearch: externalSearchTerm !== undefined,
        formatTimelineDate,
        getBarColor,
        getPredecessors,
        handleAddPredecessor,
        handleBulkDelete,
        isSelected: selection.isSelected,
        predecessorCandidates: candidates,
        scaleMinWidth,
        scroll,
        scrollContainerId,
        searchTerm,
        selectAll: selection.selectAll,
        selectedIds: selection.selectedIds,
        selectingPredecessorFor,
        setSearchTerm,
        setSelectingPredecessorFor,
        setZoomLevel,
        sortedNotes,
        timeScale: chart.timeScale,
        titlePreview,
        toggleSelect: selection.toggleSelect,
        zoomLevel,
    };
}

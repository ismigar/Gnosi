import { useCallback, useEffect, useId, useMemo, useState } from 'react';

import { calendarScale, scaleWidth } from './timelineScale';

import { observeElementResize } from '../../platform/browser-events';
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
import { parsePeriod } from '../../dates/projectPlanning';
import { useTitlePreview } from '../../editor/useTitlePreview';

import {
    buildBarColorResolver,
    buildTimelineChart,
    predecessorCandidates,
    predecessorsFor,
    resolveTimelineDateFields,
    resolvePredecessorField,
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
    allNotes,
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
    const [zoomLevel, changeZoom] = useState<TimelineZoom>('month');
    const [fitted, setFitted] = useState(true);
    const [columnWidth, setColumnWidth] = useState(320);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [viewportWidth, setViewportWidth] = useState(1000);
    const [focusDate, setFocusDate] = useState<Date | null>(null);
    const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
    useEffect(() => {
        const element = document.getElementById(scrollContainerId);
        if (!element || typeof ResizeObserver === 'undefined') return;
        return observeElementResize(element, entries => {
            const width = entries[0]?.contentRect.width;
            if (width) setViewportWidth(width);
        });
    }, [scrollContainerId]);
    const setZoomLevel = useCallback((zoom: TimelineZoom) => { changeZoom(zoom); setFitted(false); }, []);
    const toggleCollapsed = useCallback((id: string) => {
        setCollapsedIds(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }, []);
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
    const predecessorField = resolvePredecessorField(schema, activeView.predecessorField, readers);
    const getPredecessors = useCallback(
        (note: TimelineRecord) => predecessorsFor(note, enhancedPeriod, dateField, predecessorField),
        [dateField, enhancedPeriod, predecessorField],
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
    const schedulingNotes = allNotes ?? notes;
    const allChart = useMemo(() => buildTimelineChart({ dateField, endDateField, hasExplicitSorts: false,
        notes: schedulingNotes, readers, schema, timelineUnit }), [dateField, endDateField, schedulingNotes, schema, timelineUnit]);
    const scheduleOptions = useMemo(() => ({
        chartData: allChart.chartData,
        dateField,
        endDateField,
        enhancedPeriod,
        notes: schedulingNotes,
        onUpdateNote,
        planningSettings,
        predecessors: getPredecessors,
        predecessorField,
        readers,
        schema,
        skipNonWorkingDays,
        timelineUnit,
    }), [
        allChart.chartData,
        dateField,
        endDateField,
        enhancedPeriod,
        getPredecessors,
        schedulingNotes,
        onUpdateNote,
        planningSettings,
        predecessorField,
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
    const colorField = activeView.colorField || readers.fieldEntries(schema).find(([, type]) => type === 'status')?.[0] || '';
    const getBarColor = useMemo(
        () => buildBarColorResolver(schema, colorField, readers),
        [colorField, schema],
    );
    const timeScale = useMemo(() => calendarScale(chart.timeScale, timelineUnit, zoomLevel,
        localeSettings.dateLocale, fitted, focusDate, viewportWidth - columnWidth), [chart.timeScale, timelineUnit, zoomLevel, localeSettings.dateLocale, fitted, focusDate, viewportWidth, columnWidth]);
    const visibleNotes = useMemo(() => {
        let hiddenDepth: number | null = null;
        const visible = [];
        for (const note of chart.chartData) {
            if (hiddenDepth !== null && note.depth > hiddenDepth) continue;
            hiddenDepth = collapsedIds.has(note.id) ? note.depth : null;
            visible.push(note);
        }
        return visible;
    }, [chart.chartData, collapsedIds]);
    const dateValueForProgress = (note: TimelineRecord) => dateField ? note.metadata?.[dateField] : null;
    const calculatePosition = useCallback((date: Date): number => (
        timeScale
            ? timelinePosition(date, timeScale.start, timeScale.end)
            : 0
    ), [timeScale]);
    const candidates = useMemo(() => predecessorCandidates(
        selectingPredecessorFor,
        allChart.chartData,
        getPredecessors,
    ), [allChart.chartData, getPredecessors, selectingPredecessorFor]);
    const scroll = useCallback((direction: 'left' | 'right'): void => {
        document.getElementById(scrollContainerId)?.scrollBy({
            left: direction === 'left' ? -300 : 300,
            behavior: 'smooth',
        });
    }, [scrollContainerId]);
    const scaleMinWidth = `${String(scaleWidth(timeScale, timelineUnit, zoomLevel, viewportWidth - columnWidth, fitted))}px`;
    const goToDate = useCallback((date: Date) => { setFocusDate(new Date(date)); setFitted(false); }, []);
    useEffect(() => {
        if (!focusDate || !timeScale) return;
        const frame = requestAnimationFrame(() => {
            const element = document.getElementById(scrollContainerId);
            if (!element) return;
            const position = timelinePosition(focusDate, timeScale.start, timeScale.end);
            element.scrollTo({ left: Math.max(0, position / 100 * Number.parseFloat(scaleMinWidth) - (element.clientWidth - columnWidth) / 2), behavior: 'smooth' });
        });
        return () => { cancelAnimationFrame(frame); };
    }, [focusDate, timeScale, scrollContainerId, scaleMinWidth, columnWidth]);
    const fitProject = useCallback(() => {
        setFitted(true); setFocusDate(null);
        document.getElementById(scrollContainerId)?.scrollTo({ left: 0, behavior: 'smooth' });
    }, [scrollContainerId]);

    return {
        canEditDates: Boolean(onUpdateNote && dateField && (readers.fieldType(schema, dateField) === 'period' || (endDateField && endDateField !== dateField))),
        canEditDependencies: Boolean(onUpdateNote),
        scrollLeft, setScrollLeft, viewportWidth, columnWidth, setColumnWidth, visibleNotes, collapsedIds, toggleCollapsed,
        fitProject, goToDate, goToToday: () => { goToDate(new Date()); },
        updateDates: scheduling.updateDates, undo: scheduling.undo,
        canUndo: scheduling.canUndo, saving: scheduling.saving, timelineUnit,
        activeFiltersCount: readers.filters(activeView).length,
        activeSortsCount: readers.sorts(activeView).length,
        calculatePosition,
        chartData: chart.chartData,
        clearSelection: selection.clearSelection,
        externalSearch: externalSearchTerm !== undefined,
        formatTimelineDate,
        formatShortDate: date => new Intl.DateTimeFormat(localeSettings.dateLocale, timelineUnit === 'years' ? { year: 'numeric' }
            : timelineUnit === 'hours' ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }).format(date),
        getBarColor,
        getProgress: note => parsePeriod(dateValueForProgress(note)).percentComplete,
        getStatus: note => { const value = typeof colorField === 'string' ? note.metadata?.[colorField] : null; return typeof value === 'string' ? value : ''; },
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
        timeScale,
        titlePreview,
        toggleSelect: selection.toggleSelect,
        zoomLevel,
    };
}

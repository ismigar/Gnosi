import { useState } from 'react';
import { emptyFilterTree } from './filter-tree';
import type { ModalInput } from './useViewController';
import type { ViewSort, VisibleProperty, ViewJoin, RelationOption, RegistryView, Usage } from './types';
import type { AiModelRegistryEntry } from '../../../../shared/api/ai';

export function useViewState({
    preselectedTableId
}: Pick<
    ModalInput,
    'preselectedTableId'
>) {
    const [activeTab, setActiveTab] = useState('general');
    const [heading, setHeading] = useState('');
    const [headingLevel, setHeadingLevel] = useState(1);
    const [sourceTableId, setSourceTableId] = useState(preselectedTableId);
    const [viewName, setViewName] = useState('');
    const [visibleProperties, setVisibleProperties] = useState<VisibleProperty[]>([]);
    // Multi-table joins on top of the base table (`sourceTableId`). Each item:
    //   { tableId, type: 'inner'|'left'|'right', leftField, rightField }
    // where `leftField` belongs to the last table in the chain (base, or the
    // previously added join) and `rightField` belongs to `tableId`. When empty,
    // the view behaves as a classic single-table view (full back-compat).
    const [joins, setJoins] = useState<ViewJoin[]>([]);
    // User fields discovered in the records for tables WITHOUT a schema
    // registered (e.g. "Recursos", imported from the Notion clone: `properties`
    // empty but the records carry fields). Without this, the column selector
    // would only show the title. They are merged into `tableFields`.
    const [discoveredFields, setDiscoveredFields] = useState<string[]>([]);
    // Discovered fields per JOIN table (same purpose as `discoveredFields`, but
    // keyed by table id so we can build the field picker for every table that
    // participates in a multi-table view). `{ [tableId]: string[] }`.
    const [discoveredByTable, setDiscoveredByTable] = useState<Record<string, string[]>>({});
    const [viewType, setViewType] = useState('table');
    // Complex filter tree (root AND/OR group with nested rules/groups). The
    // legacy flat `filters` array is derived on save for back-compat.
    const [filterTree, setFilterTree] = useState(emptyFilterTree);
    // Ordered list of sort criteria; the first element has the highest
    // priority (e.g.: sort by `Estat` asc; ties broken by `Data` desc).
    const [sorts, setSorts] = useState<ViewSort[]>([]);
    // Snapshot of results' wikilinks in the markdown (portability). Lives in the
    // view from the registry (resultSnapshot / resultSnapshotLimit); the backend
    // honors it when saving the page. Default: enabled, 500 (0 = no limit).
    const [resultSnapshot, setResultSnapshot] = useState(true);
    const [resultSnapshotLimit, setResultSnapshotLimit] = useState(500);
    // View-type-specific options (gallery/kanban/calendar/timeline).
    // They are saved to the view and the renderer honors them; views that are not of the
    // corresponding type simply ignore them.
    const [cardSize, setCardSize] = useState('medium');
    const [galleryPreview, setGalleryPreview] = useState('cover');
    const [coverField, setCoverField] = useState('');
    const [imageFit, setImageFit] = useState('contain');
    const [groupBy, setGroupBy] = useState('');
    const [groupSort, setGroupSort] = useState('catalog');   // catalog | alpha | count
    const [groupSortDir, setGroupSortDir] = useState('asc'); // asc | desc
    const [dateField, setDateField] = useState('');
    const [endDateField, setEndDateField] = useState('');
    const [calendarView, setCalendarView] = useState('dayGridMonth');
    const [colorField, setColorField] = useState('');
    const [rowHeight, setRowHeight] = useState('normal');
    // Feed reading preferences are view settings, so embedded and full-page
    // feeds render the same way and need no extra in-content toolbar.
    const [feedPillLimit, setFeedPillLimit] = useState(5);
    const [feedExcerptLines, setFeedExcerptLines] = useState(6);
    const [feedFocus, setFeedFocus] = useState(false);
    const [summaryModel, setSummaryModel] = useState('');
    const [summaryModels, setSummaryModels] = useState<AiModelRegistryEntry[]>([]);
    // Chart view options.
    const [chartType, setChartType] = useState('bar');
    const [xField, setXField] = useState('');
    const [yField, setYField] = useState('');
    const [aggregation, setAggregation] = useState('count');
    const [saveToTableViews, setSaveToTableViews] = useState(true);
    const [error, setError] = useState('');
    // Views saved on the selected table — the user can choose one when
    // stead of having to configure everything from scratch.
    const [existingViews, setExistingViews] = useState<RegistryView[]>([]);
    const [selectedExistingViewId, setSelectedExistingViewId] = useState('');
    const [existingViewsStatus, setExistingViewsStatus] = useState('idle');
    const [existingViewsTableId, setExistingViewsTableId] = useState('');
    const [existingViewsReloadKey, setExistingViewsReloadKey] = useState(0);

    // How many pages share the selected existing view — if > 1
    // (including this one), we warn the user before propagating changes.
    const [viewUsage, setViewUsage] = useState<Usage>({ count: 0, pages: [] });
    // What to do if the user modifies a shared view:
    //   'shared' = apply changes to all pages that use it (default)
    //   'fork'   = only this page; the section is embedded without view_id and
    //              carries an inline copy of the filters/sorts/properties.
    const [editScope, setEditScope] = useState('shared');
    const [modalPinnedViewIds, setModalPinnedViewIds] = useState<Set<string>>(new Set());
    const [modalViewToDelete, setModalViewToDelete] = useState<RegistryView | null>(null);
    const [modalViewToDeleteUsage, setModalViewToDeleteUsage] = useState<Usage | null>(null);
    const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
    const [formBaselineRevision, setFormBaselineRevision] = useState(0);
    const [formBaselineSnapshot, setFormBaselineSnapshot] = useState('');
    const [autosaveStatus, setAutosaveStatus] = useState('idle');
    const [flushing, setFlushing] = useState(false);
    const [relationCache, setRelationCache] = useState<Record<string, RelationOption[] | undefined>>({});
    return {
        activeTab, setActiveTab, heading, setHeading,
        headingLevel, setHeadingLevel, sourceTableId, setSourceTableId,
        viewName, setViewName, visibleProperties, setVisibleProperties,
        joins, setJoins, discoveredFields, setDiscoveredFields,
        discoveredByTable, setDiscoveredByTable, viewType, setViewType,
        filterTree, setFilterTree, sorts, setSorts,
        resultSnapshot, setResultSnapshot, resultSnapshotLimit, setResultSnapshotLimit,
        cardSize, setCardSize, galleryPreview, setGalleryPreview,
        coverField, setCoverField, imageFit, setImageFit,
        groupBy, setGroupBy, groupSort, setGroupSort,
        groupSortDir, setGroupSortDir, dateField, setDateField,
        endDateField, setEndDateField, calendarView, setCalendarView,
        colorField, setColorField, rowHeight, setRowHeight,
        feedPillLimit, setFeedPillLimit, feedExcerptLines, setFeedExcerptLines,
        feedFocus, setFeedFocus, summaryModel, setSummaryModel,
        summaryModels, setSummaryModels, chartType, setChartType,
        xField, setXField, yField, setYField,
        aggregation, setAggregation, saveToTableViews, setSaveToTableViews,
        error, setError, existingViews, setExistingViews,
        selectedExistingViewId, setSelectedExistingViewId, existingViewsStatus, setExistingViewsStatus,
        existingViewsTableId, setExistingViewsTableId, existingViewsReloadKey, setExistingViewsReloadKey,
        viewUsage, setViewUsage, editScope, setEditScope,
        modalPinnedViewIds, setModalPinnedViewIds, modalViewToDelete, setModalViewToDelete,
        modalViewToDeleteUsage, setModalViewToDeleteUsage, discardConfirmOpen, setDiscardConfirmOpen,
        formBaselineRevision, setFormBaselineRevision, formBaselineSnapshot, setFormBaselineSnapshot,
        autosaveStatus, setAutosaveStatus, flushing, setFlushing,
        relationCache, setRelationCache
    };
}
export type useViewStateResult = ReturnType<typeof useViewState>;

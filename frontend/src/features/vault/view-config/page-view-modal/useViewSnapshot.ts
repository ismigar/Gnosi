import { useMemo } from 'react';
import type { useViewStateResult } from './useViewState';

export function useViewSnapshot({
    heading, headingLevel, sourceTableId, viewName,
    visibleProperties, joins, viewType, filterTree,
    sorts, resultSnapshot, resultSnapshotLimit, cardSize,
    galleryPreview, coverField, imageFit, groupBy,
    groupSort, groupSortDir, dateField, endDateField,
    calendarView, colorField, rowHeight, feedPillLimit,
    feedExcerptLines, feedFocus, summaryModel, chartType,
    xField, yField, aggregation, saveToTableViews,
    selectedExistingViewId, editScope, modalPinnedViewIds
}: Pick<
    useViewStateResult,
    'heading'
    | 'headingLevel'
    | 'sourceTableId'
    | 'viewName'
    | 'visibleProperties'
    | 'joins'
    | 'viewType'
    | 'filterTree'
    | 'sorts'
    | 'resultSnapshot'
    | 'resultSnapshotLimit'
    | 'cardSize'
    | 'galleryPreview'
    | 'coverField'
    | 'imageFit'
    | 'groupBy'
    | 'groupSort'
    | 'groupSortDir'
    | 'dateField'
    | 'endDateField'
    | 'calendarView'
    | 'colorField'
    | 'rowHeight'
    | 'feedPillLimit'
    | 'feedExcerptLines'
    | 'feedFocus'
    | 'summaryModel'
    | 'chartType'
    | 'xField'
    | 'yField'
    | 'aggregation'
    | 'saveToTableViews'
    | 'selectedExistingViewId'
    | 'editScope'
    | 'modalPinnedViewIds'
>) {
    const formSnapshot = useMemo(() => JSON.stringify({
        heading,
        headingLevel,
        sourceTableId,
        viewName,
        visibleProperties,
        joins,
        viewType,
        filterTree,
        sorts,
        resultSnapshot,
        resultSnapshotLimit,
        cardSize,
        galleryPreview,
        coverField,
        imageFit,
        groupBy,
        groupSort,
        groupSortDir,
        dateField,
        endDateField,
        calendarView,
        colorField,
        rowHeight,
        feedPillLimit,
        feedExcerptLines,
        feedFocus,
        summaryModel,
        chartType,
        xField,
        yField,
        aggregation,
        saveToTableViews,
        selectedExistingViewId,
        editScope,
        pinnedViewIds: [...modalPinnedViewIds].sort(),
    }), [heading, headingLevel, sourceTableId, viewName, visibleProperties, joins,
        viewType, filterTree, sorts, resultSnapshot, resultSnapshotLimit, cardSize,
        galleryPreview, coverField, imageFit, groupBy, groupSort, groupSortDir,
        dateField, endDateField, calendarView, colorField, rowHeight, feedPillLimit,
        feedExcerptLines, feedFocus, summaryModel, chartType, xField, yField,
        aggregation, saveToTableViews, selectedExistingViewId, editScope,
        modalPinnedViewIds]);
    return { formSnapshot };
}
export type useViewSnapshotResult = ReturnType<typeof useViewSnapshot>;

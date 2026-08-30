import { useEffect } from 'react';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewSessionResult } from './useViewSession';

export function useViewAutosave({
    isOpen, initializedRef, isTableMode, skipNextAutosaveRef,
    sourceTableId, visibleProperties, setAutosaveStatus, persistViewRef,
    pendingSaveRef, viewName, viewType, filterTree,
    sorts, resultSnapshot, resultSnapshotLimit, cardSize,
    galleryPreview, coverField, imageFit, groupBy,
    groupSort, groupSortDir, dateField, endDateField,
    calendarView, colorField, rowHeight, feedPillLimit,
    feedExcerptLines, feedFocus, summaryModel, chartType,
    xField, yField, aggregation
}: Pick<
    ModalInput & useViewSessionResult & useViewStateResult,
    'isOpen'
    | 'initializedRef'
    | 'isTableMode'
    | 'skipNextAutosaveRef'
    | 'sourceTableId'
    | 'visibleProperties'
    | 'setAutosaveStatus'
    | 'persistViewRef'
    | 'pendingSaveRef'
    | 'viewName'
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
>) {
    useEffect(() => {
        if (!isOpen || !initializedRef.current || !isTableMode) return;
        if (skipNextAutosaveRef.current) {
            skipNextAutosaveRef.current = false;
            return;
        }
        // Soft validation: pause autosave (no error banner) when the config is
        // incomplete; the user can keep editing. persistView still hard-validates.
        if (!sourceTableId || visibleProperties.length === 0) return;
        const doSave = async () => {
            setAutosaveStatus('saving');
            try {
                await persistViewRef.current({ closeAfter: false });
                setAutosaveStatus('saved');
            } catch {
                setAutosaveStatus('error');
            }
        };
        pendingSaveRef.current = doSave;
        const handle = setTimeout(() => { void doSave(); }, 800);
        return () => { clearTimeout(handle); };
    }, [isOpen, isTableMode, sourceTableId, viewName, viewType, filterTree, sorts,
        visibleProperties, resultSnapshot, resultSnapshotLimit, cardSize, galleryPreview,
        coverField, imageFit, groupBy, groupSort, groupSortDir, dateField, endDateField,
        calendarView, colorField, rowHeight, feedPillLimit, feedExcerptLines, feedFocus,
        summaryModel, chartType, xField, yField, aggregation, initializedRef, pendingSaveRef, persistViewRef, setAutosaveStatus, skipNextAutosaveRef]);

    // Flush the pending save when the modal unmounts (e.g. closing right after
    // an edit, inside the debounce window). Fire-and-forget: the request
    // completes even if the component is gone. Without this the last change
    // before closing would be cancelled by the clearTimeout above.
    useEffect(() => {
        return () => { void pendingSaveRef.current?.(); };
    }, [pendingSaveRef]);
    return {};
}
export type useViewAutosaveResult = ReturnType<typeof useViewAutosave>;

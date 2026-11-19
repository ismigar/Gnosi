import { DATE_FIELD_TYPES, NUMERIC_FIELD_TYPES } from './constants';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldLabelsResult } from './useViewFieldLabels';
import { viewSelectionKey, type useViewSessionResult } from './useViewSession';

export function useViewOptions({
    sortedTableFields, existingViews, existingViewsStatus, existingViewsTableId, sourceTableId, savedSelections
}: Pick<
    useViewFieldLabelsResult & useViewStateResult & useViewSessionResult,
    'sortedTableFields'
    | 'existingViews'
    | 'existingViewsStatus'
    | 'existingViewsTableId'
    | 'sourceTableId'
    | 'savedSelections'
>) {
    const localViewName = savedSelections.get(viewSelectionKey(sourceTableId, ''))?.view.name;
    // A refreshed catalog can include the very copy already represented by
    // the local draft or by its protected source. Keep one editable entry.
    const catalogIds = new Set(existingViews.map(view => view.id));
    const representedCopies = new Set<string>();
    for (const { view, registryId, sourceViewId } of savedSelections.values()) {
        if (view.table_id === sourceTableId && registryId && registryId !== sourceViewId && (!sourceViewId || catalogIds.has(sourceViewId))) {
            representedCopies.add(registryId);
        }
    }
    const pickerViews = existingViews.filter(view => !representedCopies.has(view.id));
    const groupFieldOptions = sortedTableFields;
    const dateFieldOptions = sortedTableFields.filter(f => DATE_FIELD_TYPES.has((f.type || '').toLowerCase()));
    const numericFieldOptions = sortedTableFields.filter(f => NUMERIC_FIELD_TYPES.has((f.type || '').toLowerCase()));
    // Fields suitable for the gallery cover: attachments/images/URL or fields with
    // an image name (the gallery extracts the src from it with getImageSrc).
    const coverFieldOptions = sortedTableFields.filter(f => {
        const ty = (f.type || '').toLowerCase();
        return ty === 'files' || ty === 'image' || ty === 'url' || /imatge|image|cover|portada|foto|photo|thumbnail|miniatura/i.test(f.name || '');
    });

    const existingViewsLoadError = existingViewsStatus === 'error' && existingViewsTableId === sourceTableId;
    const isLoadingExistingViews = Boolean(sourceTableId)
        && existingViewsStatus === 'loading'
        && existingViewsTableId === sourceTableId;
    return {
        groupFieldOptions, dateFieldOptions, numericFieldOptions, coverFieldOptions,
        existingViewsLoadError, isLoadingExistingViews, localViewName, pickerViews
    };
}
export type useViewOptionsResult = ReturnType<typeof useViewOptions>;

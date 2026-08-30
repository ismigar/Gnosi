import { GROUP_FIELD_TYPES, DATE_FIELD_TYPES, NUMERIC_FIELD_TYPES } from './constants';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldLabelsResult } from './useViewFieldLabels';

export function useViewOptions({
    sortedTableFields, existingViewsStatus, existingViewsTableId, sourceTableId
}: Pick<
    useViewFieldLabelsResult & useViewStateResult,
    'sortedTableFields'
    | 'existingViewsStatus'
    | 'existingViewsTableId'
    | 'sourceTableId'
>) {
    const groupFieldOptions = sortedTableFields.filter(f => GROUP_FIELD_TYPES.has((f.type || '').toLowerCase()));
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
        existingViewsLoadError, isLoadingExistingViews
    };
}
export type useViewOptionsResult = ReturnType<typeof useViewOptions>;

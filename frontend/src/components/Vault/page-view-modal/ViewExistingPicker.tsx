import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewOptionsResult } from './useViewOptions';

export function ViewExistingPicker({
    isTableMode, sourceTableId, t, selectedExistingViewId,
    setSelectedExistingViewId, isLoadingExistingViews, existingViews, viewName,
    existingViewsLoadError, setExistingViewsReloadKey
}: Pick<
    ModalInput & useViewStateResult & useViewOptionsResult,
    'isTableMode'
    | 'sourceTableId'
    | 't'
    | 'selectedExistingViewId'
    | 'setSelectedExistingViewId'
    | 'isLoadingExistingViews'
    | 'existingViews'
    | 'viewName'
    | 'existingViewsLoadError'
    | 'setExistingViewsReloadKey'
>) {
    return (<>                {!isTableMode && sourceTableId && (
        <div className="px-5 py-4 border-b border-[var(--border-primary)] bg-[var(--bg-primary)] shrink-0">
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
                {t('view.existing_view', "Existing view")}
            </label>
            <select
                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                value={selectedExistingViewId}
                onChange={e => { setSelectedExistingViewId(e.target.value); }}
                disabled={isLoadingExistingViews}
            >
                <option value="">
                    {isLoadingExistingViews
                        ? t('view.loading_views', "Loading views…")
                        : t('view.create_new_view', "— Create new view —")}
                </option>
                {existingViews.map(v => {
                    const displayedName = v.id === selectedExistingViewId
                        ? viewName
                        : v.name;
                    return (
                        <option key={v.id} value={v.id}>
                            {displayedName || t('view.unnamed', "(unnamed)")} {v.type ? `· ${v.type}` : ''}
                        </option>
                    );
                })}
            </select>
            {existingViewsLoadError && (
                <div className="mt-2 flex items-center justify-between gap-3 rounded-md border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-2.5 py-2">
                    <p className="text-[11px] text-[var(--status-error)]">
                        {t('view.existing_views_load_error', "Couldn't load the existing views. You can create a new view or retry.")}
                    </p>
                    <button
                        type="button"
                        onClick={() => { setExistingViewsReloadKey(key => key + 1); }}
                        className="shrink-0 text-xs font-semibold text-[var(--gnosi-primary)] hover:underline"
                    >
                        {t('common.retry', "Retry")}
                    </button>
                </div>
            )}
            {selectedExistingViewId && (
                <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)] leading-tight">
                    {t('view.existing_hint', "You can review/override the fields in the Fields, Filters and Sorting tabs.")}
                </p>
            )}
        </div>
    )}</>);
}

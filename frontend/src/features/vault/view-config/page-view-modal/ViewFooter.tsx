import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewClosingResult } from './useViewClosing';

export function ViewFooter({
    autosaveStatus, flushing, t, isTableMode,
    requestDiscardChanges, closeWithFlush, selectedExistingViewId
}: Pick<
    useViewStateResult & ModalInput & useViewClosingResult,
    'autosaveStatus'
    | 'flushing'
    | 't'
    | 'isTableMode'
    | 'requestDiscardChanges'
    | 'closeWithFlush'
    | 'selectedExistingViewId'
>) {
    return (<>                <div className="px-5 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex items-center justify-between gap-3 rounded-b-xl shrink-0">
        {/* Autosave status pill (table mode shows live state; embed mode
                        only shows transient states during the flush). */}
        <div className="text-xs flex items-center gap-1.5 min-h-[1rem]">
            {(autosaveStatus === 'saving' || flushing) && (
                <span className="flex items-center gap-1.5 text-[var(--gnosi-primary)]">
                    <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
                    {t('view.saving', "Saving…")}
                </span>
            )}
            {autosaveStatus === 'saved' && !flushing && (
                <span className="flex items-center gap-1.5 text-green-500">
                    <span className="inline-block w-2 h-2 rounded-full bg-current" />
                    {t('view.all_changes_saved', "All changes saved")}
                </span>
            )}
            {autosaveStatus === 'error' && !flushing && (
                <span className="flex items-center gap-1.5 text-red-500">
                    <span className="inline-block w-2 h-2 rounded-full bg-current" />
                    {t('view.error_create', "Unknown error creating the view")}
                </span>
            )}
        </div>
        <div className="flex items-center gap-2">
            {!isTableMode && (
                <button
                    type="button"
                    onClick={requestDiscardChanges}
                    disabled={flushing}
                    className="btn-gnosi btn-gnosi-secondary px-5"
                >
                    {t('common.cancel', "Cancel")}
                </button>
            )}
            <button
                onClick={() => void closeWithFlush()}
                disabled={flushing}
                className="btn-gnosi btn-gnosi-primary px-6"
            >
                {flushing ? t('view.saving', "Saving…") : (
                    isTableMode
                        ? t('common.close', "Close")
                        : (selectedExistingViewId && selectedExistingViewId !== 'default'
                            ? t('common.insert', "Insert")
                            : t('view.create_view', "Create view"))
                )}
            </button>
        </div>
    </div></>);
}

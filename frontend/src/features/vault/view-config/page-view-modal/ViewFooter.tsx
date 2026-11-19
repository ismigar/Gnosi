import { SavedFeedback } from '../../../../shared/editor/SavedFeedback';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewAutosaveResult } from './useViewAutosave';

export function ViewFooter({
    autosaveStatus, flushing, t, closeWithFlush
}: Pick<
    useViewStateResult & ModalInput & useViewAutosaveResult,
    'autosaveStatus'
    | 'flushing'
    | 't'
    | 'closeWithFlush'
>) {
    return (<>                <div className="px-5 py-4 border-t border-[var(--border-primary)] bg-[var(--bg-secondary)] flex items-center justify-between gap-3 rounded-b-xl shrink-0">
        {/* Live persistence feedback for both new and existing views. */}
        <div role="status" className="text-xs flex items-center gap-1.5 min-h-[1rem]">
            {(autosaveStatus === 'pending' || autosaveStatus === 'saving' || flushing) && (
                <span className="flex items-center gap-1.5 text-[var(--gnosi-primary)]">
                    <span className="inline-block w-2 h-2 rounded-full bg-current animate-pulse" />
                    {t('view.saving', "Saving…")}
                </span>
            )}
            {autosaveStatus === 'saved' && !flushing && (
                <SavedFeedback className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full bg-current" />
                    {t('view.all_changes_saved', "All changes saved")}
                </SavedFeedback>
            )}
            {autosaveStatus === 'error' && !flushing && (
                <span className="flex items-center gap-1.5 text-red-500">
                    <span className="inline-block w-2 h-2 rounded-full bg-current" />
                    {t('view.error_create', "Unknown error creating the view")}
                </span>
            )}
        </div>
        <div className="flex items-center gap-2">
            <button
                onClick={() => void closeWithFlush()}
                disabled={flushing}
                className="btn-gnosi btn-gnosi-primary px-6"
            >
                {t('common.close', "Close")}
            </button>
        </div>
    </div></>);
}

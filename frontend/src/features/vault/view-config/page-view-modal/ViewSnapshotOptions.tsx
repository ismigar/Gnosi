import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';

export function ViewSnapshotOptions({
    resultSnapshot, setResultSnapshot, t, resultSnapshotLimit,
    setResultSnapshotLimit
}: Pick<
    useViewStateResult & ModalInput,
    'resultSnapshot'
    | 'setResultSnapshot'
    | 't'
    | 'resultSnapshotLimit'
    | 'setResultSnapshotLimit'
>) {
    return (<>                            <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
        <label className="flex items-start gap-2 cursor-pointer">
            <input
                type="checkbox"
                checked={resultSnapshot}
                onChange={e => { setResultSnapshot(e.target.checked); }}
                className="mt-0.5 rounded border-[var(--border-primary)]"
            />
            <div>
                <span className="text-sm text-[var(--text-primary)] block">
                    {t('view.snapshot_label', "Save result links to the markdown")}
                </span>
                <span className="text-[11px] text-[var(--text-tertiary)]">
                    {t('view.snapshot_hint', "Writes a [[Title|id]] list of the pages the view returns, so Obsidian and other readers can navigate them.")}
                </span>
            </div>
        </label>
        {resultSnapshot && (
            <div className="ml-6 flex items-center gap-2">
                <label htmlFor="pvm-result-snapshot-limit" className="text-xs font-semibold text-[var(--text-secondary)]">
                    {t('view.snapshot_limit', "Max links")}
                </label>
                <input
                    id="pvm-result-snapshot-limit"
                    type="number"
                    min="0"
                    step="50"
                    value={resultSnapshotLimit}
                    onChange={e => {
                        const n = parseInt(e.target.value, 10);
                        setResultSnapshotLimit(Number.isFinite(n) && n >= 0 ? n : 0);
                    }}
                    className="w-24 text-sm border border-[var(--border-primary)] rounded-lg px-2 py-1 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none text-right"
                />
                <span className="text-[11px] text-[var(--text-tertiary)]">{t('view.snapshot_unlimited', "0 = no limit")}</span>
            </div>
        )}
    </div></>);
}

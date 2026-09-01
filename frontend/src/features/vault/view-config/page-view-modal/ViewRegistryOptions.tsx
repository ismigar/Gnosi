import { Trash2 } from 'lucide-react';
import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewActionsResult } from './useViewActions';

export function ViewRegistryOptions({
    isTableMode, sourceTableId, existingViews, t,
    modalPinnedViewIds, selectedExistingViewId, setModalPinnedViewIds, requestDeleteViewFromModal,
    viewUsage, editScope, setEditScope, saveToTableViews,
    setSaveToTableViews
}: Pick<
    ModalInput & useViewStateResult & useViewActionsResult,
    'isTableMode'
    | 'sourceTableId'
    | 'existingViews'
    | 't'
    | 'modalPinnedViewIds'
    | 'selectedExistingViewId'
    | 'setModalPinnedViewIds'
    | 'requestDeleteViewFromModal'
    | 'viewUsage'
    | 'editScope'
    | 'setEditScope'
    | 'saveToTableViews'
    | 'setSaveToTableViews'
>) {
    return (<>                            {!isTableMode && sourceTableId && existingViews.length > 0 && (
        <div className="border-t border-[var(--border-primary)] pt-4">
            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">
                {t('view.pinned_tabs', "Show tabs (views pinned to this block)")}
            </label>
            <div className="space-y-1.5 max-h-36 overflow-y-auto border border-[var(--border-primary)] rounded-lg p-2.5 bg-[var(--bg-secondary)]">
                {existingViews.map(v => {
                    const isChecked = modalPinnedViewIds.has(v.id);
                    const isAnchor = v.id === selectedExistingViewId || (v.id === 'default' && !selectedExistingViewId);
                    const canDelete = !v.is_main && v.id !== 'default';
                    return (
                        <div key={v.id} className="flex items-center justify-between gap-2 py-0.5">
                            <label className="flex items-center gap-2 text-xs text-[var(--text-primary)] cursor-pointer select-none truncate min-w-0">
                                <input
                                    type="checkbox"
                                    checked={isChecked || isAnchor}
                                    disabled={isAnchor}
                                    onChange={e => {
                                        const checked = e.target.checked;
                                        setModalPinnedViewIds(prev => {
                                            const next = new Set(prev);
                                            if (checked) {
                                                next.add(v.id);
                                            } else {
                                                next.delete(v.id);
                                            }
                                            return next;
                                        });
                                    }}
                                    className="rounded text-[var(--gnosi-primary)] focus:ring-[var(--gnosi-primary)] shrink-0"
                                />
                                <span className="truncate">{v.name || t('view.unnamed', "(unnamed)")}</span>
                                {v.type && <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">· {v.type}</span>}
                                {isAnchor && (
                                    <span className="text-[10px] text-[var(--text-tertiary)] italic shrink-0">{t('view.anchor_view', "(anchor view)")}</span>
                                )}
                            </label>
                            {canDelete && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        requestDeleteViewFromModal(v);
                                    }}
                                    className="shrink-0 p-1 text-[var(--text-tertiary)] hover:text-red-500 rounded transition-colors"
                                    title={t('views_header.delete', "Delete")}
                                >
                                    <Trash2 size={13} />
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    )}

        {selectedExistingViewId && viewUsage.count > 0 && (
            <div className="border-t border-[var(--border-primary)] pt-4">
                <p className="text-xs font-semibold text-[var(--text-secondary)] mb-1">
                    {t('view.usage_count', { count: viewUsage.count, defaultValue: "This view is already used on {{count}} pages." })}
                </p>
                {viewUsage.pages.length > 0 && (
                    <ul className="text-[11px] text-[var(--text-tertiary)] mb-2 pl-4 list-disc space-y-0.5 max-h-24 overflow-y-auto">
                        {viewUsage.pages.map((p) => (
                            <li key={p.id}>{p.title}</li>
                        ))}
                    </ul>
                )}
                <p className="text-[11px] text-[var(--text-tertiary)] mb-3">
                    {t('view.edit_scope_prompt', "If you modify the fields, choose how to apply it:")}
                </p>
                <div className="space-y-2">
                    <label className="flex items-start gap-2 cursor-pointer">
                        <input
                            type="radio"
                            name="editScope"
                            value="shared"
                            checked={editScope === 'shared'}
                            onChange={() => { setEditScope('shared'); }}
                            className="mt-0.5"
                        />
                        <div>
                            <span className="text-sm text-[var(--text-primary)] block">
                                {t('view.scope_shared', "Apply changes to all pages")}
                            </span>
                            <span className="text-[11px] text-[var(--text-tertiary)]">
                                {t('view.scope_shared_hint', "The shared view is updated and every embed reflects the changes.")}
                            </span>
                        </div>
                    </label>
                    <label className="flex items-start gap-2 cursor-pointer">
                        <input
                            type="radio"
                            name="editScope"
                            value="fork"
                            checked={editScope === 'fork'}
                            onChange={() => { setEditScope('fork'); }}
                            className="mt-0.5"
                        />
                        <div>
                            <span className="text-sm text-[var(--text-primary)] block">
                                {t('view.scope_fork', "Apply only to this page")}
                            </span>
                            <span className="text-[11px] text-[var(--text-tertiary)]">
                                {t('view.scope_fork_hint', "Disconnects this embed from the shared view and keeps a local copy. Other pages don't change.")}
                            </span>
                        </div>
                    </label>
                </div>
            </div>
        )}

        {!isTableMode && !selectedExistingViewId && (
            <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={saveToTableViews}
                        onChange={e => { setSaveToTableViews(e.target.checked); }}
                        className="rounded border-[var(--border-primary)]"
                    />
                    <span className="text-sm text-[var(--text-primary)]">
                        {t('view.save_to_table', "Also save to the table's views")}
                    </span>
                </label>
            </div>
        )}</>);
}

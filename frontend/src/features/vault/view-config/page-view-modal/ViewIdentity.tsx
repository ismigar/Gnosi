import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';

export function ViewIdentity({
    t, viewName, setViewName, isTableMode,
    sourceTableId, setSourceTableId, allTables, editingView, preselectedTableId
}: Pick<
    ModalInput & useViewStateResult,
    't'
    | 'viewName'
    | 'setViewName'
    | 'isTableMode'
    | 'sourceTableId'
    | 'setSourceTableId'
    | 'allTables'
    | 'editingView'
    | 'preselectedTableId'
>) {
    // Registry views normally have a fixed parent table, but the creation
    // dialog can also open from a page with no active table context.
    const fixedTableId = editingView?.table_id || preselectedTableId;
    const sourceIsFixed = isTableMode && Boolean(fixedTableId && allTables.some(table => table.id === fixedTableId));
    return (<>                            <div>
        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">
            {t('view.view_name', "View name")}
        </label>
        <input
            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] focus:ring-1 focus:ring-[var(--gnosi-primary)] outline-none"
            value={viewName}
            onChange={e => { setViewName(e.target.value); }}
            placeholder={t('view.view_name_ph', "e.g. By area")}
        />
    </div>

            <div>
                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.source_table', "Source table")}</label>
                <select
                    aria-label={t('view.source_table', "Source table")}
                    disabled={sourceIsFixed}
                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                    value={sourceTableId}
                    onChange={e => { setSourceTableId(e.target.value); }}
                >
                    <option value="">{t('view.pick_table', "— Select table —")}</option>
                    {allTables.map(tbl => (
                        <option key={tbl.id} value={tbl.id}>{tbl.name}</option>
                    ))}
                </select>
            </div>
        </>);
}

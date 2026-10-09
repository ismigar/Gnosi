import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';

export function ViewIdentity({
    t, viewName, setViewName, displayTitle, setDisplayTitle, isTableMode,
    sourceTableId, setSourceTableId, allTables, editingView, preselectedTableId
}: Pick<
    ModalInput & useViewStateResult,
    't'
    | 'viewName'
    | 'setViewName'
    | 'displayTitle'
    | 'setDisplayTitle'
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
            aria-label={t('view.view_name', 'View name')}
            value={viewName}
            onChange={e => { setViewName(e.target.value); }}
            placeholder={t('view.view_name_ph', "e.g. By area")}
        />
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">{t('view.catalog_name_hint')}</p>
    </div>
    <label className="block text-xs font-semibold text-[var(--text-secondary)]">
        {t('view.display_title')}
        <input className="mt-1 w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
            value={displayTitle} onChange={e => { setDisplayTitle(e.target.value); }}
            placeholder={viewName} />
        <span className="mt-1 block font-normal text-[var(--text-tertiary)]">{t('view.display_title_hint')}</span>
    </label>

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

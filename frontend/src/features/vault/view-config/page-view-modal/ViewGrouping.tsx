import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldsResult } from './useViewFields';
import type { useViewFieldLabelsResult } from './useViewFieldLabels';
import type { useViewOptionsResult } from './useViewOptions';

export function ViewGrouping({
    activeTab, viewType, t, selectedTable,
    groupBy, setGroupBy, groupFieldOptions, fieldLabel,
    groupSort, setGroupSort, groupSortDir, setGroupSortDir
}: Pick<
    useViewStateResult & ModalInput & useViewFieldsResult & useViewOptionsResult & useViewFieldLabelsResult,
    'activeTab'
    | 'viewType'
    | 't'
    | 'selectedTable'
    | 'groupBy'
    | 'setGroupBy'
    | 'groupFieldOptions'
    | 'fieldLabel'
    | 'groupSort'
    | 'setGroupSort'
    | 'groupSortDir'
    | 'setGroupSortDir'
>) {
    return (<>                    {activeTab === 'grouping' && (
        <div className="space-y-4">
            {(viewType === 'table' || viewType === 'list' || viewType === 'gallery') && (
                <div className="space-y-2">
                    <p className="text-xs text-[var(--text-secondary)]">
                        {t('view.grouping_intro', "Group records by a select or status field.")}
                    </p>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">{t('view.group_by', "Group by")}</label>
                    {!selectedTable ? (
                        <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
                    ) : (
                        <>
                            <select
                                value={groupBy}
                                onChange={e => { setGroupBy(e.target.value); }}
                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                            >
                                <option value="">{t('view.no_grouping', "No grouping")}</option>
                                {groupFieldOptions.map(f => (
                                    <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                ))}
                            </select>
                            {groupFieldOptions.length === 0 && (
                                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{t('view.no_group_fields', "No select/status field in the table to group by.")}</p>
                            )}
                        </>
                    )}
                </div>
            )}

            {(viewType === 'table' || viewType === 'list' || viewType === 'gallery') && groupBy && selectedTable && (
                <div className="space-y-2">
                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">{t('view.group_order', "Group order")}</label>
                    <div className="flex gap-2">
                        <select
                            value={groupSort}
                            onChange={e => { setGroupSort(e.target.value); }}
                            className="flex-1 text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                        >
                            <option value="catalog">{t('view.group_order_catalog', "Catalog order")}</option>
                            <option value="alpha">{t('view.group_order_alpha', "Alphabetical")}</option>
                            <option value="count">{t('view.group_order_count', "By record count")}</option>
                        </select>
                        <select
                            value={groupSortDir}
                            onChange={e => { setGroupSortDir(e.target.value); }}
                            className="w-32 text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                        >
                            <option value="asc">{t('view.asc', "Ascending")}</option>
                            <option value="desc">{t('view.desc', "Descending")}</option>
                        </select>
                    </div>
                </div>
            )}

            {viewType === 'board' && (
                <div className="space-y-2">
                    <p className="text-xs text-[var(--text-secondary)]">
                        {t('view.board_options_intro', "Choose how the kanban columns are grouped.")}
                    </p>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">{t('view.group_by', "Group by")}</label>
                    {!selectedTable ? (
                        <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
                    ) : (
                        <>
                            <select
                                value={groupBy}
                                onChange={e => { setGroupBy(e.target.value); }}
                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                            >
                                <option value="">{t('view.group_auto', "Automatic (status)")}</option>
                                {groupFieldOptions.map(f => (
                                    <option key={f.name} value={f.name}>{fieldLabel(f.name)}</option>
                                ))}
                            </select>
                            {groupFieldOptions.length === 0 && (
                                <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{t('view.no_group_fields_auto', "No select/status field in the table; it will group automatically.")}</p>
                            )}
                        </>
                    )}
                </div>
            )}

            {viewType === 'board' && groupBy && selectedTable && (
                <div className="space-y-2">
                    <label className="block text-xs font-semibold text-[var(--text-secondary)]">{t('view.group_order', "Group order")}</label>
                    <div className="flex gap-2">
                        <select
                            value={groupSort}
                            onChange={e => { setGroupSort(e.target.value); }}
                            className="flex-1 text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                        >
                            <option value="catalog">{t('view.group_order_catalog', "Catalog order")}</option>
                            <option value="alpha">{t('view.group_order_alpha', "Alphabetical")}</option>
                            <option value="count">{t('view.group_order_count', "By record count")}</option>
                        </select>
                        <select
                            value={groupSortDir}
                            onChange={e => { setGroupSortDir(e.target.value); }}
                            className="w-32 text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                        >
                            <option value="asc">{t('view.asc', "Ascending")}</option>
                            <option value="desc">{t('view.desc', "Descending")}</option>
                        </select>
                    </div>
                </div>
            )}

            {(viewType !== 'table' && viewType !== 'list' && viewType !== 'gallery' && viewType !== 'board') && (
                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.no_grouping_for_type', "This view type does not support grouping.")}</p>
            )}
        </div>
    )}</>);
}

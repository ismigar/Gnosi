import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldsResult } from './useViewFields';
import type { useViewFieldLabelsResult } from './useViewFieldLabels';
import type { useViewActionsResult } from './useViewActions';
import { FilterGroupEditor } from './FilterGroupEditor';

export function ViewFilters({
    activeTab, t, selectedTable, filterTree,
    setFilterTree, sortedTableFields, fieldMeta, fieldLabel,
    relationCache, defaultFilterValue
}: Pick<
    useViewStateResult & ModalInput & useViewFieldsResult & useViewFieldLabelsResult & useViewActionsResult,
    'activeTab'
    | 't'
    | 'selectedTable'
    | 'filterTree'
    | 'setFilterTree'
    | 'tableFields'
    | 'sortedTableFields'
    | 'fieldMeta'
    | 'fieldLabel'
    | 'relationCache'
    | 'defaultFilterValue'
>) {
    return (<>                    {activeTab === 'filters' && (
        <div>
            <p className="text-xs text-[var(--text-secondary)] mb-3">
                {t('view.filters_intro_groups', "Combine filters with And/Or and group them for complex conditions. Value \"this\" = this page's ID.")}
            </p>
            {!selectedTable ? (
                <p className="text-sm text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
            ) : (
                <FilterGroupEditor
                    node={filterTree}
                    onChange={setFilterTree}
                    depth={0}
                    ctx={{ tableFields: sortedTableFields, fieldMeta, fieldLabel, relationCache, defaultFilterValue, t }}
                />
            )}
        </div>
    )}</>);
}

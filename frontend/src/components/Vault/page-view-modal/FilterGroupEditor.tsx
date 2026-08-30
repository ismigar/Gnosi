import { Plus, Trash2 } from 'lucide-react';
import { MAX_FILTER_DEPTH } from './constants';
import { isFilterGroup } from './filter-tree';
import { FilterRuleRow } from './FilterRuleRow';
import type { FilterGroup, FilterNode, FilterContext } from './types';

export function FilterGroupEditor({ node, onChange, onRemove, depth, ctx }: { node: FilterGroup; onChange: (node: FilterGroup) => void; onRemove?: () => void; depth: number; ctx: FilterContext }) {
    const { tableFields, defaultFilterValue, t } = ctx;
    const firstField = tableFields[0]?.name || 'title';
    const rules = node.rules;
    const conj = node.conjunction === 'or' ? 'or' : 'and';

    const updateChild = (i: number, child: FilterNode) => { onChange({ ...node, rules: rules.map((r, idx) => (idx === i ? child : r)) }); };
    const removeChild = (i: number) => { onChange({ ...node, rules: rules.filter((_, idx) => idx !== i) }); };
    const addRule = () => { onChange({ ...node, rules: [...rules, { field: firstField, operator: 'equals', value: defaultFilterValue(firstField) }] }); };
    const addGroup = () => { onChange({ ...node, rules: [...rules, { conjunction: 'and', rules: [{ field: firstField, operator: 'equals', value: defaultFilterValue(firstField) }] }] }); };
    const setConjunction = (c: string) => { onChange({ ...node, conjunction: c }); };

    const isNested = depth > 0;
    return (
        <div className={isNested ? 'rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 p-2 space-y-2' : 'space-y-2'}>
            {isNested && (
                <div className="flex justify-between items-center">
                    <span className="text-[10px] uppercase tracking-wide text-[var(--text-tertiary)]">{t('view.filter_group', "Filter group")}</span>
                    <button
                        onClick={onRemove}
                        className="text-[var(--text-tertiary)] hover:text-red-500 p-0.5"
                        title={t('view.delete_group', "Delete group")}
                    >
                        <Trash2 size={13} />
                    </button>
                </div>
            )}
            {rules.map((child, i) => {
                // The conjunction prefix mirrors Notion: row 0 = "On"/Where,
                // row 1 = And/Or selector (drives the whole group), row 2+ = static.
                const prefix = i === 0 ? (
                    <span className="text-xs text-[var(--text-tertiary)] w-16 shrink-0 pl-1">{t('view.filter_where', "Where")}</span>
                ) : i === 1 ? (
                    <select
                        className="text-xs border border-[var(--border-primary)] rounded px-1.5 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-16 shrink-0"
                        value={conj}
                        onChange={e => { setConjunction(e.target.value); }}
                    >
                        <option value="and">{t('view.conj_and', "And")}</option>
                        <option value="or">{t('view.conj_or', "Or")}</option>
                    </select>
                ) : (
                    <span className="text-xs text-[var(--text-secondary)] w-16 shrink-0 pl-1">{conj === 'or' ? t('view.conj_or', "Or") : t('view.conj_and', "And")}</span>
                );
                return (
                    <div key={i} className="flex gap-2 items-start">
                        <div className="pt-1.5">{prefix}</div>
                        <div className="flex-1 min-w-0">
                            {isFilterGroup(child) ? (
                                <FilterGroupEditor node={child} onChange={c => { updateChild(i, c); }} onRemove={() => { removeChild(i); }} depth={depth + 1} ctx={ctx} />
                            ) : (
                                <FilterRuleRow rule={child} onChange={c => { updateChild(i, c); }} onRemove={() => { removeChild(i); }} ctx={ctx} />
                            )}
                        </div>
                    </div>
                );
            })}
            <div className="flex gap-2 pl-1">
                <button
                    onClick={addRule}
                    className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[var(--gnosi-primary)]/10 text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/20"
                >
                    <Plus size={12} />
                    {t('view.add_filter', "Add filter")}
                </button>
                {depth < MAX_FILTER_DEPTH && (
                    <button
                        onClick={addGroup}
                        className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-[var(--border-primary)] text-[var(--text-secondary)] hover:border-[var(--gnosi-primary)] hover:text-[var(--gnosi-primary)]"
                    >
                        <Plus size={12} />
                        {t('view.add_group', "Add group")}
                    </button>
                )}
            </div>
        </div>
    );
}

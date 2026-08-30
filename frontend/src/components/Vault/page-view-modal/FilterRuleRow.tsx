import { Trash2 } from 'lucide-react';
import { FILTER_OPERATORS } from './constants';
import { FilterValueControl } from './FilterValueControl';
import type { FilterRule, FilterContext } from './types';

export function FilterRuleRow({ rule, onChange, onRemove, ctx }: { rule: FilterRule; onChange: (rule: FilterRule) => void; onRemove: () => void; ctx: FilterContext }) {
    const { tableFields, fieldMeta, fieldLabel, relationCache, defaultFilterValue, t } = ctx;
    const meta = fieldMeta[rule.field];
    const isRelation = meta?.type === 'relation' && !!meta.relation_database_id;
    const relOpts = isRelation ? relationCache[meta.relation_database_id || ''] : null;
    return (
        <div className="flex gap-2 items-center">
            <select
                className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] flex-1"
                value={rule.field}
                onChange={e => {
                    // Changing the field resets the value to the new type's default
                    // (a relation id makes no sense in a text field, etc.).
                    const field = e.target.value;
                    const nextRule = { ...rule, field, value: defaultFilterValue(field) };
                    if (fieldMeta[field]?.type === 'period') {
                        nextRule.periodPart = rule.periodPart === 'end' ? 'end' : 'start';
                    } else {
                        delete nextRule.periodPart;
                    }
                    onChange(nextRule);
                }}
            >
                {tableFields.map(tf => (
                    <option key={tf.name} value={tf.name}>{tf.displayName || fieldLabel(tf.name)}</option>
                ))}
            </select>
            {meta?.type === 'period' && (
                <select
                    className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-36"
                    value={rule.periodPart === 'end' ? 'end' : 'start'}
                    onChange={e => { onChange({ ...rule, periodPart: e.target.value }); }}
                    aria-label={t('view.filter_period_part')}
                >
                    <option value="start">{t('view.filter_period_start')}</option>
                    <option value="end">{t('view.filter_period_end')}</option>
                </select>
            )}
            <select
                className="text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32"
                value={rule.operator}
                onChange={e => { onChange({ ...rule, operator: e.target.value }); }}
            >
                {FILTER_OPERATORS.map(op => (
                    <option key={op.value} value={op.value}>{t(`view.op_${op.value}`, op.label)}</option>
                ))}
            </select>
            <FilterValueControl rule={rule} meta={meta} relOpts={relOpts} onValue={v => { onChange({ ...rule, value: v }); }} t={t} />
            <button
                onClick={onRemove}
                className="text-[var(--text-tertiary)] hover:text-red-500 p-1"
                title={t('view.delete', "Delete")}
            >
                <Trash2 size={14} />
            </button>
        </div>
    );
}

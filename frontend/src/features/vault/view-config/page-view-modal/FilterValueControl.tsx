import { normalizeOptions } from '../../../../shared/records/model/optionCatalogUtils';
import { NO_VALUE_OPS } from './constants';
import { RelationValuePicker } from './RelationValuePicker';
import { inputValue } from './input-value';
import type { TFunction } from 'i18next';
import type { Field, FilterValue, FilterRule, RelationOption } from './types';

export function FilterValueControl({ rule, meta, relOpts, onValue, t }: { rule: FilterRule; meta?: Field; relOpts?: RelationOption[] | null; onValue: (value: FilterValue) => void; t: TFunction }) {
    const inputCls = 'text-xs border border-[var(--border-primary)] rounded px-2 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] w-32 disabled:opacity-40';
    if (NO_VALUE_OPS.includes(rule.operator)) {
        // is_empty / is_not_empty: no value is needed.
        return <input className={inputCls} value="" placeholder="—" disabled />;
    }
    const isRelation = meta?.type === 'relation' && !!meta.relation_database_id;
    if (isRelation) {
        return (
            <RelationValuePicker
                value={inputValue(rule.value)}
                onChange={v => { onValue(v); }}
                options={relOpts || []}
                loading={relOpts === undefined}
                thisLabel={t('view.filter_this', { defaultValue: "This page" })}
                placeholder={t('view.filter_pick', { defaultValue: "Pick…" })}
            />
        );
    }
    const ftype = meta?.type;
    if (ftype === 'autoria') {
        const authorValue = rule.value && typeof rule.value === 'object' && !Array.isArray(rule.value)
            ? rule.value
            : { nom: inputValue(rule.value), cognom1: '', cognom2: '' };
        const updateAuthorPart = (key: 'nom' | 'cognom1' | 'cognom2', value: string) => {
            onValue({
                nom: inputValue(authorValue.nom),
                cognom1: inputValue(authorValue.cognom1),
                cognom2: inputValue(authorValue.cognom2),
                [key]: value,
            });
        };
        return (
            <div className="grid min-w-[25rem] grid-cols-3 gap-1">
                <input
                    className={inputCls}
                    value={inputValue(authorValue.nom)}
                    onChange={e => { updateAuthorPart('nom', e.target.value); }}
                    placeholder={t('autoria.first_name', "First name")}
                    aria-label={t('autoria.first_name', "First name")}
                />
                <input
                    className={inputCls}
                    value={inputValue(authorValue.cognom1)}
                    onChange={e => { updateAuthorPart('cognom1', e.target.value); }}
                    placeholder={t('autoria.surname1', "Surname 1")}
                    aria-label={t('autoria.surname1', "Surname 1")}
                />
                <input
                    className={inputCls}
                    value={inputValue(authorValue.cognom2)}
                    onChange={e => { updateAuthorPart('cognom2', e.target.value); }}
                    placeholder={t('autoria.surname2', "Surname 2")}
                    aria-label={t('autoria.surname2', "Surname 2")}
                />
                <span className="col-span-3 text-[10px] text-[var(--text-tertiary)]">
                    {t('view.filter_text_pattern_hint')}
                </span>
            </div>
        );
    }
    const optionNames = normalizeOptions(meta?.options).map(option => option.name);
    if ((ftype === 'select' || ftype === 'status') && optionNames.length > 0) {
        return (
            <select
                className={inputCls}
                value={inputValue(rule.value)}
                onChange={e => { onValue(e.target.value); }}
            >
                <option value="">{t('view.filter_pick', { defaultValue: "Pick…" })}</option>
                {optionNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
        );
    }
    if (ftype === 'multi_select' && optionNames.length > 0) {
        const selected = Array.isArray(rule.value)
            ? rule.value.map(String)
            : (rule.value ? [inputValue(rule.value)] : []);
        return (
            <select
                multiple
                className={`${inputCls} h-20`}
                value={selected}
                onChange={e => { onValue(Array.from(e.target.selectedOptions, option => option.value)); }}
                aria-label={t('view.filter_pick', { defaultValue: "Pick…" })}
            >
                {optionNames.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
        );
    }
    if (ftype === 'checkbox') {
        // Checked = filters for marked records ('true'); unmarked = for not
        // checked ('false', which the engine also matches with empty values).
        const checked = rule.value === 'true';
        return (
            <label className={`${inputCls} flex items-center gap-2 cursor-pointer`}>
                <input
                    type="checkbox"
                    className="accent-[var(--gnosi-primary)] cursor-pointer"
                    checked={checked}
                    onChange={e => { onValue(e.target.checked ? 'true' : 'false'); }}
                />
                <span className="text-[var(--text-secondary)]">{checked ? t('view.checked', "Checked") : t('view.unchecked', "Unchecked")}</span>
            </label>
        );
    }
    if (['number', 'currency', 'percent', 'formula', 'rollup'].includes(ftype || '')) {
        return (
            <input
                type="number"
                className={inputCls}
                value={inputValue(rule.value)}
                onChange={e => { onValue(e.target.value); }}
                placeholder={t('view.value_ph', "Value")}
            />
        );
    }
    if (ftype === 'date' || ftype === 'datetime' || ftype === 'period') {
        const isToday = rule.value === 'today';
        return (
            <div className="flex gap-1">
                <select
                    className="text-xs border border-[var(--border-primary)] rounded px-1.5 py-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)]"
                    value={isToday ? 'today' : 'date'}
                    onChange={e => { onValue(e.target.value === 'today' ? 'today' : ''); }}
                >
                    <option value="today">{t('view.filter_today')}</option>
                    <option value="date">{t('view.filter_specific_date')}</option>
                </select>
                {!isToday && (
                    <input
                        type={ftype === 'datetime' ? 'datetime-local' : 'date'}
                        className={inputCls}
                        value={inputValue(rule.value)}
                        onChange={e => { onValue(e.target.value); }}
                    />
                )}
            </div>
        );
    }
    return (
        <div className="flex w-40 flex-col gap-0.5">
            <input
                className={inputCls}
                value={inputValue(rule.value)}
                onChange={e => { onValue(e.target.value); }}
                placeholder={t('view.value_this_ph', "this or value")}
            />
            <span className="text-[10px] text-[var(--text-tertiary)]">
                {t('view.filter_text_pattern_hint')}
            </span>
        </div>
    );
}

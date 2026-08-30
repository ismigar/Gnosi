import React from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeOptions } from '../optionCatalogUtils';
import { ASSIGNMENT_NUMERIC_TYPES, ASSIGNMENT_DATE_TYPES, ASSIGNMENT_DATETIME_TYPES } from './constants';
import type { AssignmentValueControlProps } from './types';
export function AssignmentValueControl({ value, onChange, fieldMeta, custom, onCustomChange }: AssignmentValueControlProps) {
    const { t } = useTranslation();
    const cls = 'w-full text-xs border border-[var(--border-primary)] rounded p-1.5 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none';

    // Free-text (formula) mode always wins when enabled.
    if (custom) {
        return (
            <div className="flex items-center gap-1 w-full">
                <input
                    type="text"
                    value={typeof value === 'boolean' ? (value ? 'true' : '') : value || ''}
                    onChange={(e) => { onChange(e.target.value); }}
                    placeholder={t('schema.button_value_or_formula', "Value or formula")}
                    className={cls}
                />
                <button
                    type="button"
                    onClick={() => { onCustomChange(false); }}
                    title={t('schema.button_value_type', "Use field-type input")}
                    className="shrink-0 px-1.5 py-1.5 text-[10px] rounded border border-[var(--border-primary)] text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10 transition-colors"
                >
                    {t('schema.button_value_type', "Type")}
                </button>
            </div>
        );
    }

    const ftype = fieldMeta?.type || '';
    const optionNames = normalizeOptions(fieldMeta?.options).map((o) => o.name);

    if (ftype === 'select' || ftype === 'status') {
        if (optionNames.length > 0) {
            return (
                <select
                    value={String(value || '')}
                    onChange={(e) => { onChange(e.target.value); }}
                    className={cls}
                >
                    <option value="">{t('schema.button_value_pick', "Pick…")}</option>
                    {optionNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
            );
        }
    }

    if (ftype === 'multi_select') {
        if (optionNames.length > 0) {
            const selected = Array.isArray(value)
                ? value.map(String)
                : (value ? [String(value)] : []);
            return (
                <select
                    multiple
                    className={`${cls} h-20`}
                    value={selected}
                    onChange={(e) => { onChange(Array.from(e.target.selectedOptions, (o) => o.value)); }}
                    aria-label={t('schema.button_value_pick', "Pick…")}
                >
                    {optionNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
            );
        }
    }

    if (ftype === 'checkbox') {
        const checked = String(value) === 'true';
        return (
            <label className={`${cls} flex items-center gap-2 cursor-pointer`}>
                <input
                    type="checkbox"
                    className="accent-[var(--gnosi-primary)] cursor-pointer"
                    checked={checked}
                    onChange={(e) => { onChange(e.target.checked ? 'true' : 'false'); }}
                />
                <span className="text-[var(--text-secondary)]">
                    {checked ? t('schema.button_value_checked', "Checked") : t('schema.button_value_unchecked', "Unchecked")}
                </span>
            </label>
        );
    }

    if (ASSIGNMENT_NUMERIC_TYPES.includes(ftype)) {
        return (
            <input
                type="number"
                value={typeof value === 'boolean' ? (value ? 'true' : '') : value || ''}
                onChange={(e) => { onChange(e.target.value); }}
                placeholder={t('schema.button_value_ph', "Value")}
                className={cls}
            />
        );
    }

    if (ASSIGNMENT_DATETIME_TYPES.includes(ftype)) {
        const isFormula = typeof value === 'string' && (value.includes('(') || value.includes('{'));
        if (isFormula) {
            return (
                <input
                    type="text"
                    value={value || ''}
                    onChange={(e) => { onChange(e.target.value); }}
                    placeholder="now()"
                    className={cls}
                />
            );
        }
        return (
            <div className="flex items-center gap-1 w-full">
                <input
                    type="datetime-local"
                    value={typeof value === 'boolean' ? (value ? 'true' : '') : value || ''}
                    onChange={(e) => { onChange(e.target.value); }}
                    className={cls}
                />
                <button
                    type="button"
                    onClick={() => { onChange('now()'); }}
                    title="now()"
                    className="shrink-0 px-1.5 py-1 text-[10px] rounded border border-[var(--border-primary)] text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10"
                >
                    now()
                </button>
            </div>
        );
    }

    if (ASSIGNMENT_DATE_TYPES.includes(ftype)) {
        const isFormula = typeof value === 'string' && (value.includes('(') || value.includes('{'));
        if (isFormula) {
            return (
                <input
                    type="text"
                    value={value || ''}
                    onChange={(e) => { onChange(e.target.value); }}
                    placeholder="today()"
                    className={cls}
                />
            );
        }
        return (
            <div className="flex items-center gap-1 w-full">
                <input
                    type="date"
                    value={typeof value === 'boolean' ? (value ? 'true' : '') : value || ''}
                    onChange={(e) => { onChange(e.target.value); }}
                    className={cls}
                />
                <button
                    type="button"
                    onClick={() => { onChange('today()'); }}
                    title="today()"
                    className="shrink-0 px-1.5 py-1 text-[10px] rounded border border-[var(--border-primary)] text-[var(--gnosi-primary)] hover:bg-[var(--gnosi-primary)]/10"
                >
                    today()
                </button>
            </div>
        );
    }

    // text / rich_text / url / email / relation / files / unknown → free text,
    // with an explicit formula toggle in case the target type is option-like.
    return (
        <input
            type="text"
            value={typeof value === 'boolean' ? (value ? 'true' : '') : value || ''}
            onChange={(e) => { onChange(e.target.value); }}
            placeholder={t('schema.button_value_or_formula', "Value or formula")}
            className={cls}
        />
    );
}

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { SortableFieldProps } from './types';
import { HelpToggleHint } from './HelpToggleHint';
export function FieldFormats({ field, idx, handleUpdateField, projectPlanningEnabled }: SortableFieldProps) {
    const { t } = useTranslation();
    return <>
            {/* Number: format (number / currency / percentage + decimals) */}
            {field.type === 'number' && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 block">
                            {t('schema.number_format', "Number format")}
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            <select
                                value={field.format?.kind || 'number'}
                                onChange={(e) => { handleUpdateField(idx, 'format', { ...(field.format || {}), kind: e.target.value }); }}
                                className="text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                            >
                                <option value="number">{t('schema.number_plain', "Number")}</option>
                                <option value="currency">{t('schema.number_currency', "Currency")}</option>
                                <option value="percent">{t('schema.number_percent', "Percent")}</option>
                                <option value="year">{t('schema.number_year', "Year")}</option>
                            </select>
                            {field.format?.kind !== 'year' && (
                                <input
                                    type="number"
                                    min="0"
                                    max="6"
                                    value={field.format?.decimals ?? ''}
                                    onChange={(e) => { handleUpdateField(idx, 'format', { ...(field.format || {}), decimals: e.target.value === '' ? undefined : Math.max(0, parseInt(e.target.value, 10) || 0) }); }}
                                    placeholder={t('schema.number_decimals', 'Decimals')}
                                    className="text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                />
                            )}
                            {field.format?.kind === 'currency' && (
                                <select
                                    value={field.format.currency || ''}
                                    onChange={(e) => { handleUpdateField(idx, 'format', { ...(field.format || {}), currency: e.target.value }); }}
                                    className="text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                >
                                    <option value="">{t('schema.currency_default', "Default")}</option>
                                    <option value="EUR (€)">EUR (€)</option>
                                    <option value="USD ($)">USD ($)</option>
                                    <option value="GBP (£)">GBP (£)</option>
                                    <option value="JPY (¥)">JPY (¥)</option>
                                    <option value="CHF (₣)">CHF (₣)</option>
                                </select>
                            )}
                        </div>
                        <p className="text-[10px] text-[var(--text-secondary)]/70 px-1">
                            {t('schema.number_format_hint', "Empty/“Number” = global Settings format. Percent shows the value as-is with “%”. “Year” drops the thousands separator (2024, not 2,024).")}
                        </p>
                    </div>
                </div>
            )}

            {/* Date/datetime: display format */}
            {(field.type === 'date' || field.type === 'datetime') && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="p-3 bg-[var(--bg-primary)] rounded-lg border border-[var(--gnosi-primary)]/20 shadow-inner space-y-2">
                        <label className="text-[10px] uppercase tracking-wider text-[var(--gnosi-primary)] font-bold ml-1 block">
                            {t('schema.date_format', "Date format")}
                        </label>
                        <select
                            value={field.format?.dateFormat || ''}
                            onChange={(e) => { handleUpdateField(idx, 'format', { ...(field.format || {}), dateFormat: e.target.value || undefined }); }}
                            className="w-full text-sm border border-[var(--border-primary)] rounded-md p-1.5 focus:ring-2 focus:ring-[var(--gnosi-primary)]/20 outline-none bg-[var(--bg-primary)] text-[var(--text-primary)]"
                        >
                            <option value="">{t('schema.date_format_global', 'Global (Settings)')}</option>
                            <option value="locale">{t('schema.date_format_locale', "By language")}</option>
                            <option value="DD/MM/YYYY">{t('schema.date_format_dmy', "DD/MM/YYYY")}</option>
                            <option value="MM/DD/YYYY">{t('schema.date_format_mdy', "MM/DD/YYYY")}</option>
                            <option value="YYYY-MM-DD">{t('schema.date_format_iso', "YYYY-MM-DD (ISO)")}</option>
                        </select>
                    </div>
                </div>
            )}

            {field.type === 'period' && projectPlanningEnabled && (
                <div className="px-3 pb-3 pt-1 border-t border-[var(--border-primary)] bg-[var(--gnosi-primary)]/5 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="space-y-3 rounded-lg border border-[var(--gnosi-primary)]/20 bg-[var(--bg-primary)] p-3 shadow-inner">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--gnosi-primary)]">
                            {t('schema.period_planning', "Project planning")}
                        </label>
                        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
                            <span>{t('schema.period_unit', 'Timeline unit')}</span>
                            <select
                                value={field.period_unit || 'days'}
                                onChange={(event) => { handleUpdateField(idx, 'period_unit', event.target.value); }}
                                className="rounded border border-[var(--border-primary)] bg-[var(--bg-primary)] px-2 py-1 text-[var(--text-primary)]"
                            >
                                <option value="hours">{t('schema.period_unit_hours', 'Hours')}</option>
                                <option value="days">{t('schema.period_unit_days', 'Days')}</option>
                                <option value="years">{t('schema.period_unit_years', 'Years')}</option>
                            </select>
                        </label>
                        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                            <input
                                type="checkbox"
                                checked={field.duration_enabled !== false}
                                onChange={(event) => { handleUpdateField(idx, 'duration_enabled', event.target.checked); }}
                                className="mt-0.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)]"
                            />
                            <div>
                                <div className="flex items-center gap-1">
                                    <strong className="text-[var(--text-primary)]">
                                        {t('schema.period_duration_enabled', "Add working-day duration")}
                                    </strong>
                                    <HelpToggleHint text={t('schema.period_duration_hint', "Calculate finish from start and duration.")} />
                                </div>
                            </div>
                        </label>
                        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                            <input
                                type="checkbox"
                                checked={field.predecessors_enabled !== false}
                                onChange={(event) => { handleUpdateField(idx, 'predecessors_enabled', event.target.checked); }}
                                className="mt-0.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)]"
                            />
                            <div>
                                <div className="flex items-center gap-1">
                                    <strong className="text-[var(--text-primary)]">
                                        {t('schema.period_predecessors_enabled', "Add predecessors")}
                                    </strong>
                                    <HelpToggleHint text={t('schema.period_predecessors_hint', "Calculate an empty start from the latest predecessor finish.")} />
                                </div>
                            </div>
                        </label>
                        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                            <input
                                type="checkbox"
                                checked={field.skip_non_working_days !== false}
                                onChange={(event) => { handleUpdateField(idx, 'skip_non_working_days', event.target.checked); }}
                                className="mt-0.5 rounded border-[var(--border-primary)] text-[var(--gnosi-primary)]"
                            />
                            <div>
                                <div className="flex items-center gap-1">
                                    <strong className="text-[var(--text-primary)]">
                                        {t('schema.period_skip_non_working', "Skip non-working time")}
                                    </strong>
                                    <HelpToggleHint text={t('schema.period_skip_non_working_hint', "Use the plugin's work week and holiday calendar.")} />
                                </div>
                            </div>
                        </label>
                    </div>
                </div>
            )}

    </>;
}

import type { ModalInput } from './useViewController';
import type { useViewStateResult } from './useViewState';
import type { useViewFieldsResult } from './useViewFields';
import type { useViewFieldLabelsResult } from './useViewFieldLabels';
import type { useViewOptionsResult } from './useViewOptions';

export function ViewDateOptions({
    viewType, t, selectedTable, dateField,
    setDateField, dateFieldOptions, fieldLabel, calendarView,
    setCalendarView, fieldMeta, endDateField, setEndDateField,
    colorField, setColorField, groupFieldOptions
}: Pick<
    useViewStateResult & ModalInput & useViewFieldsResult & useViewOptionsResult & useViewFieldLabelsResult,
    'viewType'
    | 't'
    | 'selectedTable'
    | 'dateField'
    | 'setDateField'
    | 'dateFieldOptions'
    | 'fieldLabel'
    | 'calendarView'
    | 'setCalendarView'
    | 'fieldMeta'
    | 'endDateField'
    | 'setEndDateField'
    | 'colorField'
    | 'setColorField'
    | 'groupFieldOptions'
>) {
    return (<>                            {(viewType === 'calendar' || viewType === 'timeline') && (
        <div className="border-t border-[var(--border-primary)] pt-4 space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">{viewType === 'calendar' ? t('view.calendar_options', "Calendar options") : t('view.timeline_options', "Timeline options")}</p>
            {!selectedTable ? (
                <p className="text-xs text-[var(--text-tertiary)] italic">{t('view.pick_table_first', "Select a table first.")}</p>
            ) : (
                <>
                    <div>
                        <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{viewType === 'timeline' ? t('view.start_date', "Start date") : t('view.date_field', "Date field")}</label>
                        <select
                            value={dateField}
                            onChange={e => { setDateField(e.target.value); }}
                            className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                        >
                            <option value="">{t('view.date_auto', "Automatic (first date field)")}</option>
                            {dateFieldOptions.map(f => (
                                <option key={f.name} value={f.name}>{f.displayName || fieldLabel(f.name)}</option>
                            ))}
                        </select>
                    </div>
                    {viewType === 'calendar' && (
                        <div>
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.initial_view', "Initial view")}</label>
                            <select
                                value={calendarView}
                                onChange={e => { setCalendarView(e.target.value); }}
                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                            >
                                <option value="dayGridMonth">{t('view.cal_month', "Month")}</option>
                                <option value="timeGridWeek">{t('view.cal_week', "Week")}</option>
                                <option value="timeGridDay">{t('view.cal_day', "Day")}</option>
                                <option value="multiMonthYear">{t('view.cal_year', "Year")}</option>
                            </select>
                        </div>
                    )}
                    {viewType === 'timeline' && (
                        fieldMeta[dateField]?.type === 'period' ? (
                            <p className="text-[11px] text-[var(--text-tertiary)]">{t('view.period_hint', "The period field already defines each bar's start and end.")}</p>
                        ) : (
                            <div>
                                <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.end_date', "End date (optional)")}</label>
                                <select
                                    value={endDateField}
                                    onChange={e => { setEndDateField(e.target.value); }}
                                    className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                                >
                                    <option value="">{t('view.end_none', "None (one-day duration)")}</option>
                                    {dateFieldOptions.map(f => (
                                        <option key={f.name} value={f.name}>{f.displayName || fieldLabel(f.name)}</option>
                                    ))}
                                </select>
                            </div>
                        )
                    )}
                    {viewType === 'timeline' && (
                        <div>
                            <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1">{t('view.color_by', "Color by")}</label>
                            <select
                                value={colorField}
                                onChange={e => { setColorField(e.target.value); }}
                                className="w-full text-sm border border-[var(--border-primary)] rounded-lg px-3 py-2 bg-[var(--bg-primary)] text-[var(--text-primary)] outline-none focus:ring-1 focus:ring-[var(--gnosi-primary)]"
                            >
                                <option value="">{t('view.color_single', "Single color (default)")}</option>
                                {groupFieldOptions.map(f => (
                                    <option key={f.name} value={f.name}>{f.displayName || fieldLabel(f.name)}</option>
                                ))}
                            </select>
                            <p className="mt-1 text-[10px] text-[var(--text-tertiary)]">{t('view.color_hint', "Colors each bar by this field's value (uses its options' colors).")}</p>
                        </div>
                    )}
                    {dateFieldOptions.length === 0 && (
                        <p className="text-[11px] text-[var(--text-tertiary)]">{t('view.no_date_fields', "No date field in the table; the modification date will be used.")}</p>
                    )}
                </>
            )}
        </div>
    )}</>);
}

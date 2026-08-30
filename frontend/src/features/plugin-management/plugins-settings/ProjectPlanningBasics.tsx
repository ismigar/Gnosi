import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { SELECT_STYLE, stringSetting } from './pluginSettingsModel';
import type { ProjectPlanningController } from './projectPlanningModel';

interface ProjectPlanningBasicsProps {
    readonly controller: ProjectPlanningController;
}

export function ProjectPlanningBasics({ controller }: ProjectPlanningBasicsProps) {
    const { t, i18n } = useTranslation();
    const tp = (key: string, fallback: string): string => (
        t(`settings.plugins.${key}`, { defaultValue: fallback })
    );
    const weekdayOptions: readonly [number, string][] = [
        [1, tp('planning_monday', 'Mon')], [2, tp('planning_tuesday', 'Tue')],
        [3, tp('planning_wednesday', 'Wed')], [4, tp('planning_thursday', 'Thu')],
        [5, tp('planning_friday', 'Fri')], [6, tp('planning_saturday', 'Sat')],
        [0, tp('planning_sunday', 'Sun')],
    ];

    const tableSelect = (key: string, label: string) => (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>{label}</span>
            <select
                style={SELECT_STYLE}
                value={stringSetting(controller.config, key)}
                disabled={controller.loading}
                onChange={(event) => {
                    controller.setPlanningSettings({ [key]: event.target.value });
                }}
            >
                <option value="">{tp('planning_table_none', '— Not configured —')}</option>
                {controller.sortedTables.map((table) => (
                    <option key={table.id} value={table.id}>{table.name || table.id}</option>
                ))}
            </select>
        </label>
    );

    return (
        <>
            <div style={{ color: 'var(--text-tertiary, #94a3b8)', fontSize: 12 }}>
                {tp('planning_intro', 'Choose the project and task tables, then define the calendar used by enhanced period fields.')}
            </div>
            {tableSelect('project_table_id', tp('planning_project_table', 'Projects table'))}
            {tableSelect('task_table_id', tp('planning_task_table', 'Tasks table'))}
            <fieldset style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <legend style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    {tp('planning_working_week', 'Working week')}
                </legend>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {weekdayOptions.map(([day, label]) => (
                        <label key={day} style={{
                            alignItems: 'center', border: '1px solid var(--border-primary, #e2e8f0)',
                            borderRadius: 7, color: 'var(--text-secondary, #475569)', display: 'flex',
                            fontSize: 11, gap: 4, padding: '5px 7px',
                        }}>
                            <input
                                type="checkbox"
                                checked={controller.workingWeekdays.includes(day)}
                                onChange={() => {
                                    controller.toggleWeekday(day);
                                }}
                            />
                            {label}
                        </label>
                    ))}
                </div>
            </fieldset>
            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1fr' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>
                        {tp('planning_hours_per_day', 'Working hours per day')}
                    </span>
                    <input
                        type="text"
                        inputMode="decimal"
                        min="0.25"
                        max="24"
                        step="0.25"
                        style={SELECT_STYLE}
                        value={controller.hoursPerDayInput}
                        aria-label={tp('planning_hours_per_day', 'Working hours per day')}
                        onChange={(event) => {
                            controller.setHoursPerDayInput(event.target.value);
                        }}
                        onBlur={(event) => {
                            controller.commitHoursPerDay(event.target.value);
                        }}
                    />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>
                        {tp('planning_workday_start', 'Working day starts')}
                    </span>
                    <input
                        type="time"
                        style={SELECT_STYLE}
                        value={stringSetting(controller.config, 'workday_start') || '09:00'}
                        onChange={(event) => {
                            controller.setPlanningSettings({ workday_start: event.target.value || '09:00' });
                        }}
                    />
                </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12, fontWeight: 600 }}>
                    {tp('planning_holidays', 'Non-working holidays')}
                </span>
                <div style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--text-secondary, #475569)', fontSize: 12 }}>{tp('planning_holiday_year', 'Year')}</span>
                    <input
                        type="number" min="1900" max="2200" step="1"
                        value={controller.holidayYearInput}
                        aria-label={tp('planning_holiday_year', 'Holiday year')}
                        onChange={(event) => {
                            controller.setHolidayYearInput(event.target.value);
                        }}
                        onBlur={(event) => {
                            controller.commitHolidayYear(event.target.value);
                        }}
                        style={{ ...SELECT_STYLE, width: 120 }}
                    />
                </div>
                <div style={{ border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                        <thead><tr style={{ background: 'var(--bg-secondary, #f8fafc)', textAlign: 'left' }}>
                            <th style={{ fontWeight: 700, padding: '8px 10px' }}>{tp('planning_holiday_date', 'Date')}</th>
                            <th style={{ fontWeight: 700, padding: '8px 10px' }}>{tp('planning_holiday_description', 'Description')}</th>
                            <th style={{ padding: '8px 10px', width: 40 }} />
                        </tr></thead>
                        <tbody>
                            {controller.holidayRows.map((row, index) => (
                                <tr key={`${row.date || 'new'}-${String(index)}`}>
                                    <td style={{ borderTop: '1px solid var(--border-primary, #e2e8f0)', padding: '6px 10px' }}>
                                        <input
                                            type="date" lang={i18n.language}
                                            min={`${String(controller.holidayYear)}-01-01`}
                                            max={`${String(controller.holidayYear)}-12-31`}
                                            value={row.date}
                                            aria-label={tp('planning_holiday_date', 'Holiday date')}
                                            onChange={(event) => {
                                                controller.updateHolidayRow(index, 'date', event.target.value.startsWith(`${String(controller.holidayYear)}-`) ? event.target.value : '');
                                            }}
                                            onBlur={() => {
                                                controller.saveHolidays();
                                            }}
                                            style={{ ...SELECT_STYLE, minWidth: 150 }}
                                        />
                                    </td>
                                    <td style={{ borderTop: '1px solid var(--border-primary, #e2e8f0)', padding: '6px 10px' }}>
                                        <input
                                            type="text" value={row.description}
                                            aria-label={tp('planning_holiday_description', 'Holiday description')}
                                            placeholder={tp('planning_holiday_description_placeholder', 'e.g. Local holiday')}
                                            onChange={(event) => {
                                                controller.updateHolidayRow(index, 'description', event.target.value);
                                            }}
                                            onBlur={() => {
                                                controller.saveHolidays();
                                            }}
                                            style={SELECT_STYLE}
                                        />
                                    </td>
                                    <td style={{ borderTop: '1px solid var(--border-primary, #e2e8f0)', padding: '6px 10px' }}>
                                        <button type="button" className="btn-gnosi btn-gnosi-secondary" style={{ padding: '6px 8px' }} aria-label={tp('planning_delete_holiday', 'Delete holiday')} title={tp('planning_delete_holiday', 'Delete holiday')} onClick={() => { controller.removeHolidayRow(index); }}><Trash2 size={14} /></button>
                                    </td>
                                </tr>
                            ))}
                            {controller.holidayRows.length === 0 && <tr><td colSpan={3} style={{ color: 'var(--text-tertiary, #94a3b8)', padding: 10 }}>{tp('planning_no_holidays', 'No holidays configured for this year.')}</td></tr>}
                        </tbody>
                    </table>
                </div>
                <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={controller.addHolidayRow}>{tp('planning_add_holiday', 'Add holiday')}</button>
            </label>
        </>
    );
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { useTranslation, Trans } from 'react-i18next';
import { CalendarDays, CalendarRange, Hash, MessageSquare, Share2, LayoutDashboard, BrainCircuit, Puzzle, Settings, Trash2, Upload, Download, ShieldCheck, Globe, KeyRound, Scissors, PackageCheck, Store, RefreshCw, Search, Send, BookOpen, Languages, Users, Inbox, Calendar, Database, Cpu, NotebookTabs, Clock3 } from 'lucide-react';
import { BUILTIN_PLUGINS } from '../plugins/registry';
import { usePlugins } from '../plugins/usePlugins';
import { reloadPlugins } from '../plugins/usePluginHost';
import ConfirmModal from './ConfirmModal';
import ResourcesPluginConfig from './ResourcesPluginConfig';
import { sortFieldItems } from '../utils/fieldOrdering';
import { SettingsSectionTabs } from './SettingsSectionTabs';
import { notifyError } from '../lib/notifyError';

const ICONS = {
    CalendarDays, CalendarRange, Hash, MessageSquare, Share2, LayoutDashboard,
    BrainCircuit, Scissors, BookOpen, Languages, Users, Inbox, Calendar,
    Database, Cpu, NotebookTabs, Clock3,
};

const isValidIsoDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

const getHolidayRowsForYear = (holidays, descriptions, year) => {
    const descriptionMap = descriptions && typeof descriptions === 'object' ? descriptions : {};
    return (Array.isArray(holidays) ? holidays : [])
        .map((date) => String(date))
        .filter((date) => date.startsWith(`${year}-`) && isValidIsoDate(date))
        .sort()
        .map((date) => ({ date, description: String(descriptionMap[date] || '') }));
};

const SELECT_STYLE = {
    width: '100%', padding: '8px 10px', borderRadius: 8, fontSize: 13,
    border: '1px solid var(--border-primary, #e2e8f0)',
    background: 'var(--bg-primary, #fff)', color: 'var(--text-primary, #0f172a)',
};

const LLM_WIKI_AUTOSAVE_DELAY_MS = 600;

const isNewerVersion = (candidate, current) => {
    const parse = (value) => String(value || '')
        .replace(/^v/i, '')
        .split(/[.-]/)
        .slice(0, 3)
        .map((part) => Number.parseInt(part, 10));
    const next = parse(candidate);
    const installed = parse(current);
    if (next.some(Number.isNaN) || installed.some(Number.isNaN)) return false;
    for (let index = 0; index < Math.max(next.length, installed.length); index += 1) {
        const nextPart = next[index] || 0;
        const installedPart = installed[index] || 0;
        if (nextPart !== installedPart) return nextPart > installedPart;
    }
    return false;
};

/**
 * Configuration for the daily-notes plugin: allows using a database (table)
 * as the source of the "Daily Note" (e.g. "Logbook") instead of the
 * `Daily Notes/` folder. The date column is auto-detected (first field of type
 * `date`) and can be confirmed/changed. Clearing the DB reverts to the classic behavior.
 */
export function DailyNotesConfig() {
    const { t } = useTranslation();
    const tp = (k, opts) => t('settings.plugins.' + k, opts);
    const { getPluginSettings, setPluginSettings } = usePlugins();
    const cfg = getPluginSettings('daily-notes');
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        axios.get('/api/vault/tables')
            .then((res) => { if (alive) setTables(Array.isArray(res.data) ? res.data : []); })
            .catch(() => { if (alive) setTables([]); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    const sortedTables = sortFieldItems(tables, (table) => table.name || table.id);
    const selectedTable = tables.find((t) => t.id === cfg.source_table_id) || null;
    const dateProps = sortFieldItems((selectedTable?.properties || []).filter((p) => p.type === 'date'));

    const onPickTable = (tableId) => {
        if (!tableId) {
            setPluginSettings('daily-notes', { source_table_id: '', date_property: '' });
            return;
        }
        const t = tables.find((x) => x.id === tableId);
        const firstDate = sortFieldItems((t?.properties || []).filter((p) => p.type === 'date'))[0];
        setPluginSettings('daily-notes', {
            source_table_id: tableId,
            date_property: firstDate ? firstDate.id : '',
        });
    };

    return (
        <div style={{
            marginTop: 8, padding: '12px 14px', borderRadius: 10,
            border: '1px dashed var(--border-primary, #e2e8f0)',
            background: 'var(--bg-primary, #fff)',
            display: 'flex', flexDirection: 'column', gap: 12,
        }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                <Trans i18nKey="settings.plugins.daily_intro" components={{ code: <code /> }} />
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                    {tp('source_db')}
                </span>
                <select
                    style={SELECT_STYLE}
                    value={cfg.source_table_id || ''}
                    disabled={loading}
                    onChange={(e) => onPickTable(e.target.value)}
                >
                    <option value="">{tp('source_none')}</option>
                    {sortedTables.map((t) => (
                        <option key={t.id} value={t.id}>{t.name || t.id}</option>
                    ))}
                </select>
            </label>

            {selectedTable && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                        {tp('date_column')}
                    </span>
                    {dateProps.length === 0 ? (
                        <span style={{ fontSize: 12, color: '#dc2626' }}>
                            {tp('no_date_column')}
                        </span>
                    ) : (
                        <select
                            style={SELECT_STYLE}
                            value={cfg.date_property || (dateProps[0] && dateProps[0].id) || ''}
                            onChange={(e) => setPluginSettings('daily-notes', { date_property: e.target.value })}
                        >
                            {dateProps.map((p) => (
                                <option key={p.id} value={p.id}>{p.name || p.id}</option>
                            ))}
                        </select>
                    )}
                </label>
            )}
        </div>
    );
}

export function ProjectPlanningConfig() {
    const { t, i18n: i18nInstance } = useTranslation();
    const tp = useCallback((key, options) => t('settings.plugins.' + key, options), [t]);
    const { getPluginSettings, setPluginSettings } = usePlugins();
    const config = getPluginSettings('project-planning');
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);
    const defaultHolidayYear = new Date().getFullYear();
    const [holidayYear, setHolidayYear] = useState(
        Number(config.holiday_year) || defaultHolidayYear,
    );
    const [holidayYearInput, setHolidayYearInput] = useState(
        String(Number(config.holiday_year) || defaultHolidayYear),
    );
    const [holidayRows, setHolidayRows] = useState(() => getHolidayRowsForYear(
        config.holidays,
        config.holiday_descriptions,
        Number(config.holiday_year) || defaultHolidayYear,
    ));
    const [hoursPerDayInput, setHoursPerDayInput] = useState(String(config.hours_per_day ?? 8));
    const [planningState, setPlanningState] = useState(null);
    const [planningLoading, setPlanningLoading] = useState(true);
    const [planningError, setPlanningError] = useState('');
    const [projectPages, setProjectPages] = useState([]);
    const [taskPages, setTaskPages] = useState([]);
    const [resourceDraft, setResourceDraft] = useState({
        name: '', type: 'work', calendar_id: 'project-default', availability_units: 100, standard_rate: 0,
    });
    const [calendarDraft, setCalendarDraft] = useState('');
    const [assignmentDraft, setAssignmentDraft] = useState({
        project_id: '', task_id: '', resource_id: '', planned_work_hours: 0, start: '', end: '',
    });
    const [levelingProposal, setLevelingProposal] = useState(null);

    const refreshPlanning = useCallback(async () => {
        setPlanningLoading(true);
        try {
            const response = await axios.get('/api/planning/state');
            setPlanningState(response.data);
            setPlanningError('');
        } catch (error) {
            console.error('Project planning: could not load resources:', error);
            setPlanningError(tp('planning_resources_load_error', { defaultValue: 'Could not load planning resources.' }));
        } finally {
            setPlanningLoading(false);
        }
    }, [tp]);

    useEffect(() => {
        let alive = true;
        axios.get('/api/vault/tables')
            .then((response) => {
                if (alive) setTables(Array.isArray(response.data) ? response.data : []);
            })
            .catch((error) => {
                if (alive) {
                    console.error('Project planning: could not load tables:', error);
                    setTables([]);
                }
            })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    useEffect(() => {
        void refreshPlanning();
    }, [refreshPlanning]);

    useEffect(() => {
        if (!config.task_table_id) {
            setTaskPages([]);
            return undefined;
        }
        let alive = true;
        axios.get(`/api/vault/pages/by-table/${encodeURIComponent(config.task_table_id)}`, { params: { include_templates: false } })
            .then((response) => {
                if (alive) setTaskPages(Array.isArray(response.data) ? response.data : []);
            })
            .catch((error) => {
                console.error('Project planning: could not load task pages:', error);
                if (alive) setTaskPages([]);
            });
        return () => { alive = false; };
    }, [config.task_table_id]);

    useEffect(() => {
        if (!config.project_table_id) {
            setProjectPages([]);
            setAssignmentDraft((current) => ({ ...current, project_id: '' }));
            return undefined;
        }
        let alive = true;
        axios.get(`/api/vault/pages/by-table/${encodeURIComponent(config.project_table_id)}`, { params: { include_templates: false } })
            .then((response) => {
                if (alive) setProjectPages(Array.isArray(response.data) ? response.data : []);
            })
            .catch((error) => {
                console.error('Project planning: could not load project pages:', error);
                if (alive) setProjectPages([]);
            });
        return () => { alive = false; };
    }, [config.project_table_id]);

    useEffect(() => {
        const nextYear = Number(config.holiday_year) || defaultHolidayYear;
        setHolidayYear(nextYear);
        setHolidayYearInput(String(nextYear));
        setHolidayRows(getHolidayRowsForYear(config.holidays, config.holiday_descriptions, nextYear));
    }, [config.holiday_year, config.holidays, config.holiday_descriptions, defaultHolidayYear]);

    useEffect(() => {
        setHoursPerDayInput(String(config.hours_per_day ?? 8));
    }, [config.hours_per_day]);

    const setPlanningSettings = (patch) => {
        setPluginSettings('project-planning', patch);
        const calendarPatch = {};
        if (Object.hasOwn(patch, 'working_weekdays')) calendarPatch.working_weekdays = patch.working_weekdays;
        if (Object.hasOwn(patch, 'holidays')) calendarPatch.holidays = patch.holidays;
        if (Object.hasOwn(patch, 'hours_per_day')) calendarPatch.hours_per_day = patch.hours_per_day;
        if (Object.hasOwn(patch, 'workday_start')) calendarPatch.workday_start = patch.workday_start;
        if (Object.keys(calendarPatch).length) {
            axios.patch('/api/planning/calendars/project-default', calendarPatch)
                .then(() => refreshPlanning())
                .catch((error) => console.error('Project planning: could not sync default calendar:', error));
        }
    };

    const sortedTables = sortFieldItems(
        tables,
        (table) => table.name || table.id,
        i18nInstance.language,
    );
    const sortedProjects = sortFieldItems(
        projectPages,
        (page) => page.title || page.id,
        i18nInstance.language,
    );
    const sortedTasks = sortFieldItems(
        taskPages,
        (page) => page.title || page.id,
        i18nInstance.language,
    );
    const workingWeekdays = Array.isArray(config.working_weekdays)
        ? config.working_weekdays.map(Number)
        : [1, 2, 3, 4, 5];
    const weekdayOptions = [
        [1, tp('planning_monday', { defaultValue: "Mon" })],
        [2, tp('planning_tuesday', { defaultValue: "Tue" })],
        [3, tp('planning_wednesday', { defaultValue: "Wed" })],
        [4, tp('planning_thursday', { defaultValue: "Thu" })],
        [5, tp('planning_friday', { defaultValue: "Fri" })],
        [6, tp('planning_saturday', { defaultValue: "Sat" })],
        [0, tp('planning_sunday', { defaultValue: "Sun" })],
    ];
    const toggleWeekday = (day) => {
        const next = workingWeekdays.includes(day)
            ? workingWeekdays.filter((candidate) => candidate !== day)
            : [...workingWeekdays, day];
        if (next.length === 0) return;
        setPlanningSettings({ working_weekdays: next });
    };
    const commitHolidayYear = (value) => {
        const nextYear = Math.min(2200, Math.max(1900, Number(value) || defaultHolidayYear));
        setHolidayYear(nextYear);
        setHolidayYearInput(String(nextYear));
        setHolidayRows(getHolidayRowsForYear(config.holidays, config.holiday_descriptions, nextYear));
        setPlanningSettings({ holiday_year: nextYear });
    };
    const commitHoursPerDay = (value) => {
        const parsed = Number(String(value).replace(',', '.'));
        const fallback = Number(config.hours_per_day) || 8;
        const nextHours = Math.min(24, Math.max(0.25, Number.isFinite(parsed) ? parsed : fallback));
        setHoursPerDayInput(String(nextHours));
        setPlanningSettings({ hours_per_day: nextHours });
    };
    const saveHolidays = (rows = holidayRows) => {
        const yearPrefix = `${holidayYear}-`;
        const holidaysForYear = rows
            .map((row) => ({ date: row.date.trim(), description: row.description.trim() }))
            .filter((row) => row.date.startsWith(yearPrefix) && isValidIsoDate(row.date))
            .filter((row, index, rows) => rows.findIndex((candidate) => candidate.date === row.date) === index)
            .sort((left, right) => left.date.localeCompare(right.date));
        const existingHolidays = (Array.isArray(config.holidays) ? config.holidays : [])
            .filter((holiday) => !String(holiday).startsWith(yearPrefix));
        const existingDescriptions = config.holiday_descriptions && typeof config.holiday_descriptions === 'object'
            ? config.holiday_descriptions
            : {};
        const holidayDescriptions = Object.fromEntries(
            Object.entries(existingDescriptions)
                .filter(([date]) => !date.startsWith(yearPrefix))
                .filter(([, description]) => String(description).trim()),
        );
        holidaysForYear.forEach(({ date, description }) => {
            if (description) holidayDescriptions[date] = description;
        });
        const holidays = [...new Set([...existingHolidays, ...holidaysForYear.map(({ date }) => date)])].sort();
        setHolidayRows(holidaysForYear);
        setPlanningSettings({ holidays, holiday_descriptions: holidayDescriptions, holiday_year: holidayYear });
    };

    const updateHolidayRow = (index, field, value) => {
        setHolidayRows((current) => current.map((row, rowIndex) => (
            rowIndex === index ? { ...row, [field]: value } : row
        )));
    };

    const addHolidayRow = () => {
        setHolidayRows((current) => [...current, { date: '', description: '' }]);
    };

    const removeHolidayRow = (index) => {
        const nextRows = holidayRows.filter((_, rowIndex) => rowIndex !== index);
        setHolidayRows(nextRows);
        saveHolidays(nextRows);
    };

    const createResource = async () => {
        try {
            await axios.post('/api/planning/resources', resourceDraft);
            setResourceDraft({ name: '', type: 'work', calendar_id: 'project-default', availability_units: 100, standard_rate: 0 });
            await refreshPlanning();
        } catch (error) {
            setPlanningError(error.response?.data?.detail || tp('planning_resource_save_error', { defaultValue: 'Could not save the resource.' }));
        }
    };

    const createCalendar = async () => {
        try {
            await axios.post('/api/planning/calendars', {
                name: calendarDraft,
                working_weekdays: workingWeekdays,
                holidays: Array.isArray(config.holidays) ? config.holidays : [],
                hours_per_day: config.hours_per_day ?? 8,
                workday_start: config.workday_start || '09:00',
            });
            setCalendarDraft('');
            await refreshPlanning();
        } catch (error) {
            setPlanningError(error.response?.data?.detail || tp('planning_calendar_save_error', { defaultValue: 'Could not save the calendar.' }));
        }
    };

    const deleteCalendar = async (calendarId) => {
        try {
            await axios.delete(`/api/planning/calendars/${encodeURIComponent(calendarId)}`);
            await refreshPlanning();
        } catch (error) {
            setPlanningError(error.response?.data?.detail || tp('planning_calendar_delete_error', { defaultValue: 'Could not delete the calendar.' }));
        }
    };

    const deleteResource = async (resourceId) => {
        try {
            await axios.delete(`/api/planning/resources/${encodeURIComponent(resourceId)}`);
            await refreshPlanning();
        } catch (error) {
            setPlanningError(error.response?.data?.detail || tp('planning_resource_delete_error', { defaultValue: 'Could not delete the resource.' }));
        }
    };

    const createAssignment = async () => {
        try {
            await axios.post('/api/planning/assignments', {
                ...assignmentDraft,
                project_id: assignmentDraft.project_id || null,
                planned_work_hours: Number(assignmentDraft.planned_work_hours) || 0,
                start: assignmentDraft.start || null,
                end: assignmentDraft.end || null,
            });
            setAssignmentDraft({ project_id: '', task_id: '', resource_id: '', planned_work_hours: 0, start: '', end: '' });
            await refreshPlanning();
        } catch (error) {
            setPlanningError(error.response?.data?.detail || tp('planning_assignment_save_error', { defaultValue: 'Could not save the assignment.' }));
        }
    };

    const deleteAssignment = async (assignmentId) => {
        try {
            await axios.delete(`/api/planning/assignments/${encodeURIComponent(assignmentId)}`);
            await refreshPlanning();
        } catch (error) {
            setPlanningError(error.response?.data?.detail || tp('planning_assignment_delete_error', { defaultValue: 'Could not delete the assignment.' }));
        }
    };

    const previewLeveling = async () => {
        try {
            const response = await axios.get('/api/planning/leveling/proposal');
            setLevelingProposal(response.data);
            setPlanningError('');
        } catch (error) {
            setPlanningError(error.response?.data?.detail || tp('planning_leveling_load_error', { defaultValue: 'Could not generate the leveling proposal.' }));
        }
    };

    const tableSelect = (key, label) => (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                {label}
            </span>
            <select
                style={SELECT_STYLE}
                value={config[key] || ''}
                disabled={loading}
                onChange={(event) => setPlanningSettings({ [key]: event.target.value })}
            >
                <option value="">{tp('planning_table_none', { defaultValue: "— Not configured —" })}</option>
                {sortedTables.map((table) => (
                    <option key={table.id} value={table.id}>{table.name || table.id}</option>
                ))}
            </select>
        </label>
    );

    return (
        <div style={{
            marginTop: 8,
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px dashed var(--border-primary, #e2e8f0)',
            background: 'var(--bg-primary, #fff)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
        }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                {tp('planning_intro', { defaultValue: "Choose the project and task tables, then define the calendar used by enhanced period fields." })}
            </div>
            {tableSelect(
                'project_table_id',
                tp('planning_project_table', { defaultValue: "Projects table" }),
            )}
            {tableSelect(
                'task_table_id',
                tp('planning_task_table', { defaultValue: "Tasks table" }),
            )}
            <fieldset style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <legend style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)', marginBottom: 4 }}>
                    {tp('planning_working_week', { defaultValue: "Working week" })}
                </legend>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {weekdayOptions.map(([day, label]) => (
                        <label
                            key={day}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '5px 7px',
                                borderRadius: 7,
                                border: '1px solid var(--border-primary, #e2e8f0)',
                                fontSize: 11,
                                color: 'var(--text-secondary, #475569)',
                            }}
                        >
                            <input
                                type="checkbox"
                                checked={workingWeekdays.includes(day)}
                                onChange={() => toggleWeekday(day)}
                            />
                            {label}
                        </label>
                    ))}
                </div>
            </fieldset>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                        {tp('planning_hours_per_day', { defaultValue: "Working hours per day" })}
                    </span>
                    <input
                        type="text"
                        inputMode="decimal"
                        min="0.25"
                        max="24"
                        step="0.25"
                        style={SELECT_STYLE}
                        value={hoursPerDayInput}
                        aria-label={tp('planning_hours_per_day', { defaultValue: 'Working hours per day' })}
                        onChange={(event) => setHoursPerDayInput(event.target.value)}
                        onBlur={(event) => commitHoursPerDay(event.target.value)}
                    />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                        {tp('planning_workday_start', { defaultValue: "Working day starts" })}
                    </span>
                    <input
                        type="time"
                        style={SELECT_STYLE}
                        value={config.workday_start || '09:00'}
                        onChange={(event) => setPlanningSettings({
                            workday_start: event.target.value || '09:00',
                        })}
                    />
                </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                    {tp('planning_holidays', { defaultValue: "Non-working holidays" })}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary, #475569)' }}>
                        {tp('planning_holiday_year', { defaultValue: 'Year' })}
                    </span>
                    <input
                        type="number"
                        min="1900"
                        max="2200"
                        step="1"
                        value={holidayYearInput}
                        aria-label={tp('planning_holiday_year', { defaultValue: 'Holiday year' })}
                        onChange={(event) => setHolidayYearInput(event.target.value)}
                        onBlur={(event) => commitHolidayYear(event.target.value)}
                        style={{ ...SELECT_STYLE, width: 120 }}
                    />
                </div>
                <div style={{ border: '1px solid var(--border-primary, #e2e8f0)', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-secondary, #f8fafc)', textAlign: 'left' }}>
                                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{tp('planning_holiday_date', { defaultValue: 'Date' })}</th>
                                <th style={{ padding: '8px 10px', fontWeight: 700 }}>{tp('planning_holiday_description', { defaultValue: 'Description' })}</th>
                                <th style={{ width: 40, padding: '8px 10px' }} />
                            </tr>
                        </thead>
                        <tbody>
                            {holidayRows.map((row, index) => (
                                <tr key={`${row.date || 'new'}-${index}`}>
                                    <td style={{ padding: '6px 10px', borderTop: '1px solid var(--border-primary, #e2e8f0)' }}>
                                        <input
                                            type="date"
                                            lang={i18nInstance.language}
                                            min={`${holidayYear}-01-01`}
                                            max={`${holidayYear}-12-31`}
                                            value={row.date}
                                            aria-label={tp('planning_holiday_date', { defaultValue: 'Holiday date' })}
                                            onChange={(event) => updateHolidayRow(
                                                index,
                                                'date',
                                                event.target.value.startsWith(`${holidayYear}-`) ? event.target.value : '',
                                            )}
                                            onBlur={saveHolidays}
                                            style={{ ...SELECT_STYLE, minWidth: 150 }}
                                        />
                                    </td>
                                    <td style={{ padding: '6px 10px', borderTop: '1px solid var(--border-primary, #e2e8f0)' }}>
                                        <input
                                            type="text"
                                            value={row.description}
                                            aria-label={tp('planning_holiday_description', { defaultValue: 'Holiday description' })}
                                            placeholder={tp('planning_holiday_description_placeholder', { defaultValue: 'e.g. Local holiday' })}
                                            onChange={(event) => updateHolidayRow(index, 'description', event.target.value)}
                                            onBlur={saveHolidays}
                                            style={SELECT_STYLE}
                                        />
                                    </td>
                                    <td style={{ padding: '6px 10px', borderTop: '1px solid var(--border-primary, #e2e8f0)' }}>
                                        <button type="button" className="btn-gnosi btn-gnosi-secondary" style={{ padding: '6px 8px' }} aria-label={tp('planning_delete_holiday', { defaultValue: 'Delete holiday' })} title={tp('planning_delete_holiday', { defaultValue: 'Delete holiday' })} onClick={() => removeHolidayRow(index)}><Trash2 size={14} /></button>
                                    </td>
                                </tr>
                            ))}
                            {!holidayRows.length && (
                                <tr>
                                    <td colSpan="3" style={{ padding: '10px', color: 'var(--text-tertiary, #94a3b8)' }}>{tp('planning_no_holidays', { defaultValue: 'No holidays configured for this year.' })}</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                <button type="button" className="btn-gnosi btn-gnosi-secondary" onClick={addHolidayRow}>{tp('planning_add_holiday', { defaultValue: 'Add holiday' })}</button>
            </label>
            <div style={{ borderTop: '1px solid var(--border-primary, #e2e8f0)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary, #0f172a)' }}>
                    {tp('planning_calendars_title', { defaultValue: 'Resource calendars' })}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                    {tp('planning_calendars_intro', { defaultValue: 'Project default is the base calendar for the project and for resources without their own calendar. Create another calendar when a resource follows a different schedule.' })}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <input
                        style={SELECT_STYLE}
                        value={calendarDraft}
                        placeholder={tp('planning_calendar_name', { defaultValue: 'Calendar name' })}
                        onChange={(event) => setCalendarDraft(event.target.value)}
                    />
                    <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!calendarDraft.trim()} onClick={createCalendar}>{tp('planning_add_calendar', { defaultValue: 'Add calendar' })}</button>
                </div>
                {!planningLoading && (planningState?.calendars || []).map((calendar) => (
                    <div key={calendar.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <span>{calendar.id === 'project-default' ? tp('planning_project_default_calendar', { defaultValue: 'Project default (base calendar)' }) : calendar.name} · {calendar.hours_per_day} h/{tp('planning_day', { defaultValue: 'day' })}</span>
                        {calendar.id !== 'project-default' && <button type="button" className="btn-gnosi btn-gnosi-secondary" style={{ padding: '6px 8px' }} aria-label={tp('planning_delete_calendar', { defaultValue: 'Delete calendar' })} title={tp('planning_delete_calendar', { defaultValue: 'Delete calendar' })} onClick={() => deleteCalendar(calendar.id)}><Trash2 size={14} /></button>}
                    </div>
                ))}
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary, #0f172a)' }}>
                    {tp('planning_resources_title', { defaultValue: 'Resource pool' })}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                    {tp('planning_resources_intro', { defaultValue: 'Define the people, teams, materials, or costs that can be used by assignments. Availability, rates, and calendars are used to calculate workload and capacity warnings; tasks are never moved automatically.' })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 100px minmax(120px, 1fr) 75px 90px', gap: 8 }}>
                    <input
                        style={SELECT_STYLE}
                        value={resourceDraft.name}
                        placeholder={tp('planning_resource_name', { defaultValue: 'Resource name' })}
                        onChange={(event) => setResourceDraft({ ...resourceDraft, name: event.target.value })}
                    />
                    <select style={SELECT_STYLE} value={resourceDraft.type} onChange={(event) => setResourceDraft({ ...resourceDraft, type: event.target.value })}>
                        <option value="work">{tp('planning_resource_work', { defaultValue: 'Work' })}</option>
                        <option value="material">{tp('planning_resource_material', { defaultValue: 'Material' })}</option>
                        <option value="cost">{tp('planning_resource_cost', { defaultValue: 'Cost' })}</option>
                    </select>
                    <select style={SELECT_STYLE} disabled={resourceDraft.type !== 'work'} value={resourceDraft.calendar_id} onChange={(event) => setResourceDraft({ ...resourceDraft, calendar_id: event.target.value })}>
                        {(planningState?.calendars || []).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
                    </select>
                    <input type="number" min="1" max="1000" style={SELECT_STYLE} value={resourceDraft.availability_units} title={tp('planning_resource_capacity', { defaultValue: 'Availability (%)' })} onChange={(event) => setResourceDraft({ ...resourceDraft, availability_units: Number(event.target.value) || 100 })} />
                    <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!resourceDraft.name.trim()} onClick={createResource}>{tp('planning_add_resource', { defaultValue: 'Add' })}</button>
                </div>
                {!planningLoading && (planningState?.resources || []).map((resource) => (
                    <div key={resource.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <span>{resource.name} · {resource.type} · {resource.availability_units}% · {resource.standard_rate}/h</span>
                        <button type="button" className="btn-gnosi btn-gnosi-secondary" style={{ padding: '6px 8px' }} aria-label={tp('planning_delete_resource', { defaultValue: 'Delete resource' })} title={tp('planning_delete_resource', { defaultValue: 'Delete resource' })} onClick={() => deleteResource(resource.id)}><Trash2 size={14} /></button>
                    </div>
                ))}
                {!planningLoading && !(planningState?.resources || []).length && <span style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>{tp('planning_no_resources', { defaultValue: 'No resources yet.' })}</span>}
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary, #0f172a)', marginTop: 4 }}>
                    {tp('planning_assignments_title', { defaultValue: 'Assignments' })}
                </div>
                <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--bg-secondary, #f8fafc)', color: 'var(--text-secondary, #475569)', fontSize: 12, lineHeight: 1.45 }}>
                    {tp('planning_assignments_intro', { defaultValue: 'An assignment links one resource to one task in a project. Planned hours and dates calculate workload, cost, and capacity warnings; they do not move or edit the task.' })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                    <select style={SELECT_STYLE} value={assignmentDraft.project_id} aria-label={tp('planning_select_project', { defaultValue: 'Select project' })} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, project_id: event.target.value })}>
                        <option value="">{tp('planning_select_project', { defaultValue: 'Select project' })}</option>
                        {sortedProjects.map((project) => <option key={project.id} value={project.id}>{project.title || project.id}</option>)}
                    </select>
                    <select style={SELECT_STYLE} value={assignmentDraft.task_id} aria-label={tp('planning_select_task', { defaultValue: 'Select task' })} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, task_id: event.target.value })}>
                        <option value="">{tp('planning_select_task', { defaultValue: 'Select task' })}</option>
                        {sortedTasks.map((page) => <option key={page.id} value={page.id}>{page.title || page.id}</option>)}
                    </select>
                    <select style={SELECT_STYLE} value={assignmentDraft.resource_id} aria-label={tp('planning_select_resource', { defaultValue: 'Select resource' })} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, resource_id: event.target.value })}>
                        <option value="">{tp('planning_select_resource', { defaultValue: 'Select resource' })}</option>
                        {(planningState?.resources || []).map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                    </select>
                    <input type="number" min="0" step="0.25" style={SELECT_STYLE} value={assignmentDraft.planned_work_hours} title={tp('planning_assignment_hours', { defaultValue: 'Planned hours' })} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, planned_work_hours: event.target.value })} />
                    <input type="datetime-local" style={SELECT_STYLE} value={assignmentDraft.start} title={tp('planning_assignment_start', { defaultValue: 'Assignment start' })} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, start: event.target.value })} />
                    <input type="datetime-local" style={SELECT_STYLE} value={assignmentDraft.end} title={tp('planning_assignment_end', { defaultValue: 'Assignment end' })} onChange={(event) => setAssignmentDraft({ ...assignmentDraft, end: event.target.value })} />
                    <button type="button" className="btn-gnosi btn-gnosi-primary" disabled={!assignmentDraft.task_id || !assignmentDraft.resource_id || (config.project_table_id && !assignmentDraft.project_id)} onClick={createAssignment}>{tp('planning_add_assignment', { defaultValue: 'Add assignment' })}</button>
                </div>
                {!planningLoading && (planningState?.assignments || []).map((assignment) => (
                    <div key={assignment.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12 }}>
                        <span>
                            {(projectPages.find((project) => project.id === assignment.project_id)?.title || assignment.project_id || tp('planning_project_not_set', { defaultValue: 'Project not set' }))}
                            {' · '}
                            {(taskPages.find((task) => task.id === assignment.task_id)?.title || assignment.task_id)}
                            {' · '}
                            {(planningState?.resources || []).find((resource) => resource.id === assignment.resource_id)?.name || assignment.resource_id}
                            {' · '}
                            {assignment.planned_work_hours} h
                        </span>
                        <button type="button" className="btn-gnosi btn-gnosi-secondary" style={{ padding: '6px 8px' }} aria-label={tp('planning_delete_assignment', { defaultValue: 'Delete assignment' })} title={tp('planning_delete_assignment', { defaultValue: 'Delete assignment' })} onClick={() => deleteAssignment(assignment.id)}><Trash2 size={14} /></button>
                    </div>
                ))}
                {!planningLoading && (planningState?.allocation?.warnings || []).map((warning) => (
                    <div key={`${warning.resource_id}-${warning.date}`} style={{ fontSize: 12, color: '#b45309' }}>
                        {warning.message}
                    </div>
                ))}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button type="button" className="btn-gnosi btn-gnosi-secondary" disabled={!(planningState?.allocation?.warnings || []).length} onClick={previewLeveling}>{tp('planning_preview_leveling', { defaultValue: 'Preview leveling' })}</button>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary, #94a3b8)' }}>{tp('planning_leveling_review_only', { defaultValue: 'Suggestions never change task dates automatically.' })}</span>
                </div>
                {(levelingProposal?.proposals || []).map((proposal) => (
                    <div key={proposal.id} style={{ fontSize: 12, color: 'var(--text-secondary, #475569)' }}>
                        {tp('planning_leveling_proposal', { defaultValue: 'Move task {{task}} to {{start}} after reviewing the proposal.', task: proposal.task_id, start: proposal.suggested_start })}
                    </div>
                ))}
                {levelingProposal && !(levelingProposal.proposals || []).length && <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>{tp('planning_no_leveling_proposal', { defaultValue: 'No dated assignment can be safely proposed for leveling.' })}</div>}
                {!planningLoading && planningState && <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>{tp('planning_estimated_cost', { defaultValue: 'Estimated assignment cost: {{cost}}', cost: planningState.allocation?.total_estimated_cost ?? 0 })}</div>}
                {planningError && <div style={{ fontSize: 12, color: '#dc2626' }}>{planningError}</div>}
            </div>
        </div>
    );
}

/* Column types the browser extension can render as a form control. Mirrors
 * PROMPTABLE_TYPES in `backend/services/web_clipper.py`: computed columns and
 * the ones needing the app's own pickers cannot be filled from the popup. */
const CLIPPER_PROMPTABLE_TYPES = new Set([
    'text', 'rich_text', 'number', 'select', 'multi_select',
    'status', 'date', 'datetime', 'checkbox', 'url',
]);

/* Sentinel for "do not feed this role" (empty means auto-detect instead). */
const CLIPPER_NO_MAPPING = '__none__';

/**
 * Configuration for the web-clipper plugin: which table the browser extension
 * saves into, which columns receive the URL/tags/note, and which columns the
 * popup prompts for. With no table designated the clipper keeps its classic
 * behaviour (a note in `Clips/`).
 */
export function WebClipperConfig() {
    const { t, i18n: i18nInstance } = useTranslation();
    const tp = (k, opts) => t('settings.plugins.' + k, opts);
    const { getPluginSettings, setPluginSettings } = usePlugins();
    const cfg = getPluginSettings('web-clipper');
    const [tables, setTables] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let alive = true;
        axios.get('/api/vault/tables')
            .then((res) => { if (alive) setTables(Array.isArray(res.data) ? res.data : []); })
            .catch((err) => { if (alive) { console.error('Web clipper: could not load tables:', err); setTables([]); } })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, []);

    const sortedTables = sortFieldItems(tables, (candidate) => candidate.name || candidate.id, i18nInstance.language);
    const table = tables.find((tbl) => tbl.id === cfg.table_id) || null;
    const properties = sortFieldItems(
        (table?.properties || []).filter((p) => CLIPPER_PROMPTABLE_TYPES.has(p.type)),
        (property) => property.name || property.id,
        i18nInstance.language,
    );
    const selectedFields = Array.isArray(cfg.fields) ? cfg.fields : [];

    const onPickTable = (tableId) => {
        // Changing table invalidates every column reference: keep nothing.
        setPluginSettings('web-clipper', {
            table_id: tableId,
            url_property: '',
            tags_property: '',
            content_property: '',
            fields: [],
        });
    };

    const toggleField = (fieldId) => {
        const next = selectedFields.includes(fieldId)
            ? selectedFields.filter((f) => f !== fieldId)
            : [...selectedFields, fieldId];
        setPluginSettings('web-clipper', { fields: next });
    };

    /* `unmappedLabel` names what happens when no column takes the role, which
     * differs per role: the note falls back to the page body, the tags to the
     * frontmatter. Calling all of them "no column" hid that. */
    const roleSelect = (key, label, types, unmappedLabel) => (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>{label}</span>
            <select
                style={SELECT_STYLE}
                value={cfg[key] || ''}
                onChange={(e) => setPluginSettings('web-clipper', { [key]: e.target.value })}
            >
                <option value="">{tp('clipper_auto', { defaultValue: "Automatic" })}</option>
                <option value={CLIPPER_NO_MAPPING}>
                    {unmappedLabel || tp('clipper_unmapped', { defaultValue: "No column" })}
                </option>
                {sortFieldItems(
                    (table?.properties || []).filter((p) => types.includes(p.type)),
                    (property) => property.name || property.id,
                    i18nInstance.language,
                )
                    .map((p) => <option key={p.id} value={p.id}>{p.name || p.id}</option>)}
            </select>
        </label>
    );

    return (
        <div style={{
            marginTop: 8, padding: '12px 14px', borderRadius: 10,
            border: '1px dashed var(--border-primary, #e2e8f0)',
            background: 'var(--bg-primary, #fff)',
            display: 'flex', flexDirection: 'column', gap: 12,
        }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                {tp('clipper_intro', { defaultValue: "Choose which table the browser extension saves into. The fields you tick show up in the extension form so you can fill them before saving." })}
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                    {tp('clipper_table', { defaultValue: "Destination table" })}
                </span>
                <select
                    style={SELECT_STYLE}
                    value={cfg.table_id || ''}
                    disabled={loading}
                    onChange={(e) => onPickTable(e.target.value)}
                >
                    <option value="">{tp('clipper_table_none', { defaultValue: "None (note in the Clips/ folder)" })}</option>
                    {sortedTables.map((tbl) => (
                        <option key={tbl.id} value={tbl.id}>{tbl.name || tbl.id}</option>
                    ))}
                </select>
            </label>

            {table && (
                <>
                    {roleSelect('url_property', tp('clipper_url_column', { defaultValue: "URL column" }), ['url', 'text'])}
                    {roleSelect(
                        'tags_property',
                        tp('clipper_tags_column', { defaultValue: "Tags column" }),
                        ['multi_select'],
                        tp('clipper_tags_frontmatter', { defaultValue: "No column (tags in the frontmatter)" }),
                    )}
                    {roleSelect(
                        'content_property',
                        tp('clipper_content_column', { defaultValue: "Note column" }),
                        ['text', 'rich_text'],
                        tp('clipper_content_body', { defaultValue: "Page body" }),
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                            {tp('clipper_fields', { defaultValue: "Fields the extension asks for" })}
                        </span>
                        {properties.length === 0 ? (
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                                {tp('clipper_no_fields', { defaultValue: "This table has no columns that can be filled from the browser." })}
                            </span>
                        ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {properties.map((p) => {
                                    const checked = selectedFields.includes(p.id);
                                    return (
                                        <label
                                            key={p.id}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                                                padding: '5px 9px', borderRadius: 999, fontSize: 12,
                                                border: '1px solid var(--border-primary, #e2e8f0)',
                                                background: checked ? '#eef2ff' : 'var(--bg-secondary, #f8fafc)',
                                                color: checked ? '#4338ca' : 'var(--text-secondary, #475569)',
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleField(p.id)}
                                                style={{ margin: 0 }}
                                            />
                                            {p.name || p.id}
                                        </label>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}

/**
 * Configuration for the llm-wiki plugin: designates which table plays the
 * Brain (LLM Wiki knowledge base) role. Mirrors the References designation
 * but per-vault (`<vault>/.gnosi/llm_wiki.json`). The backend guarantees the
 * knowledge schema (Tipus, Fonts→Recursos, verification status, ...).
 */
export function LlmWikiConfig() {
    const { t } = useTranslation();
    const tp = (k, opts) => t('settings.plugins.' + k, opts);
    const [tables, setTables] = useState([]);
    const [draft, setDraft] = useState({
        version: 2,
        brain_table_id: '',
        target_table: '',
        source_tables: [],
        index_field_ids: [],
        brain_roles: {},
        configured: false,
    });
    const [serverState, setServerState] = useState(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [confirmCreate, setConfirmCreate] = useState(false);
    const [lint, setLint] = useState(null);
    const [lintBusy, setLintBusy] = useState(false);
    const [semanticBusy, setSemanticBusy] = useState(false);
    const [pendingSuggestions, setPendingSuggestions] = useState(0);
    const autosaveTimerRef = useRef(null);
    const persistedDraftRef = useRef('');
    const latestDraftRef = useRef(draft);

    useEffect(() => {
        latestDraftRef.current = draft;
    }, [draft]);

    const reload = () => Promise.all([
        axios.get('/api/vault/tables').then((r) => (Array.isArray(r.data) ? r.data : [])).catch(() => []),
        axios.get('/api/vault/llm-wiki/config').then((r) => r.data || {}).catch(() => ({})),
        axios.get('/api/vault/llm-wiki/suggestions').then((r) => (r.data?.suggestions || []).length).catch(() => 0),
    ]).then(([tbls, state, pending]) => {
        setTables(tbls);
        setServerState(state);
        if (state?.config) {
            persistedDraftRef.current = JSON.stringify(state.config);
            setDraft(state.config);
        }
        setPendingSuggestions(pending);
    }).finally(() => setLoading(false));

    const runLint = async () => {
        setLintBusy(true);
        setError('');
        try {
            const r = await axios.post('/api/vault/llm-wiki/maintenance?semantic=false');
            setLint(r.data?.lint || null);
        } catch (err) {
            console.error('LLM Wiki maintenance failed:', err);
            setError(err.response?.data?.detail || tp('llm_wiki_error', { defaultValue: "The Brain could not be updated." }));
        } finally { setLintBusy(false); }
    };

    const runSemanticAudit = async () => {
        setSemanticBusy(true);
        setError('');
        try {
            const response = await axios.post('/api/vault/llm-wiki/maintenance?semantic=true');
            setLint(response.data?.lint || null);
            setPendingSuggestions(response.data?.suggestions_pending || 0);
        } catch (err) {
            console.error('LLM Wiki semantic audit failed:', err);
            setError(err.response?.data?.detail || tp('llm_wiki_error', { defaultValue: "The Brain could not be updated." }));
        } finally { setSemanticBusy(false); }
    };

    useEffect(() => { reload(); return undefined; }, []);

    const brainTable = tables.find((table) => table.id === draft.brain_table_id) || null;
    const selectedSourceIds = new Set((draft.source_tables || []).map((source) => source.table_id));
    const categoricalProps = sortFieldItems((brainTable?.properties || []).filter((prop) => (
        ['relation', 'select', 'multi_select', 'status'].includes(prop.type)
        && !/tipus de nota|note type/i.test(prop.name || '')
        && !(
            prop.type === 'relation'
            && selectedSourceIds.has(prop.relation_database_id)
        )
    )));

    const detectSource = (table) => {
        const props = table?.properties || [];
        const normalized = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
        const title = props.find((prop) => prop.type === 'title')
            || props.find((prop) => ['title', 'titol', 'nom', 'name'].includes(normalized(prop.name)));
        const files = props.filter((prop) => (
            ['files', 'file', 'attachment', 'attachments'].includes(prop.type)
            || /file|fitxer|arxiu|adjunt/.test(normalized(prop.name))
        ));
        const urls = props.filter((prop) => prop.type === 'url' || ['url', 'enllac', 'link'].includes(normalized(prop.name)));
        const language = props.find((prop) => ['language', 'idioma', 'llengua', 'lang'].includes(normalized(prop.name)));
        const dimensionMappings = {};
        for (const fieldId of draft.index_field_ids || []) {
            const brainProp = (brainTable?.properties || []).find((prop) => prop.id === fieldId);
            const sourceProp = props.find((prop) => normalized(prop.name) === normalized(brainProp?.name));
            dimensionMappings[fieldId] = sourceProp
                ? { mode: 'source', source_property_id: sourceProp.id, fixed_value: null }
                : { mode: 'ai', source_property_id: '', fixed_value: null };
        }
        return {
            table_id: table.id,
            title_property_id: title?.id || '',
            attachment_property_ids: files.map((prop) => prop.id),
            url_property_ids: urls.map((prop) => prop.id),
            language_property_id: language?.id || '',
            include_body: false,
            relation_property_id: '',
            dimension_mappings: dimensionMappings,
        };
    };

    const onPickBrain = (tableId) => {
        setDraft((current) => ({
            ...current,
            brain_table_id: tableId,
            target_table: tableId,
            index_field_ids: [],
            source_tables: (current.source_tables || []).filter((source) => source.table_id !== tableId),
        }));
    };

    const toggleSource = (table) => {
        setDraft((current) => {
            const exists = (current.source_tables || []).some((source) => source.table_id === table.id);
            return {
                ...current,
                source_tables: exists
                    ? current.source_tables.filter((source) => source.table_id !== table.id)
                    : [...(current.source_tables || []), detectSource(table)],
            };
        });
    };

    const updateSource = (tableId, updater) => {
        setDraft((current) => ({
            ...current,
            source_tables: (current.source_tables || []).map((source) => (
                source.table_id === tableId ? updater(source) : source
            )),
        }));
    };

    const toggleInputProperty = (tableId, key, propertyId) => {
        updateSource(tableId, (source) => {
            const current = Array.isArray(source[key]) ? source[key] : [];
            return {
                ...source,
                [key]: current.includes(propertyId)
                    ? current.filter((id) => id !== propertyId)
                    : [...current, propertyId],
            };
        });
    };

    const toggleIndexField = (fieldId) => {
        setDraft((current) => {
            const enabled = (current.index_field_ids || []).includes(fieldId);
            const nextIds = enabled
                ? current.index_field_ids.filter((id) => id !== fieldId)
                : [...(current.index_field_ids || []), fieldId];
            const brainProp = (brainTable?.properties || []).find((prop) => prop.id === fieldId);
            const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
            const nextSources = (current.source_tables || []).map((source) => {
                const sourceTable = tables.find((table) => table.id === source.table_id);
                const sourceProp = (sourceTable?.properties || []).find((prop) => normalize(prop.name) === normalize(brainProp?.name));
                const mappings = { ...(source.dimension_mappings || {}) };
                if (enabled) {
                    delete mappings[fieldId];
                } else {
                    mappings[fieldId] = sourceProp
                        ? { mode: 'source', source_property_id: sourceProp.id, fixed_value: null }
                        : { mode: 'ai', source_property_id: '', fixed_value: null };
                }
                return { ...source, dimension_mappings: mappings };
            });
            return { ...current, index_field_ids: nextIds, source_tables: nextSources };
        });
    };

    const save = async (config = latestDraftRef.current) => {
        const payload = {
            ...config,
            ui_locale: config.ui_locale || 'en',
        };
        const payloadSignature = JSON.stringify(payload);
        setBusy(true);
        setError('');
        try {
            const response = await axios.put('/api/vault/llm-wiki/config', payload);
            setServerState(response.data);
            if (response.data?.config) {
                persistedDraftRef.current = JSON.stringify(response.data.config);
                if (JSON.stringify(latestDraftRef.current) === payloadSignature) {
                    setDraft(response.data.config);
                }
            }
        } catch (err) {
            console.error('Could not save the LLM Wiki configuration:', err);
            setError(err.response?.data?.detail || tp('llm_wiki_save_error', { defaultValue: "The configuration could not be saved." }));
        } finally { setBusy(false); }
    };

    useEffect(() => {
        if (loading || busy) return undefined;
        const isComplete = draft.brain_table_id && (draft.source_tables || []).length > 0;
        if (!isComplete || JSON.stringify(draft) === persistedDraftRef.current) return undefined;
        autosaveTimerRef.current = setTimeout(() => {
            autosaveTimerRef.current = null;
            save(draft);
        }, LLM_WIKI_AUTOSAVE_DELAY_MS);
        return () => {
            if (autosaveTimerRef.current) {
                clearTimeout(autosaveTimerRef.current);
                autosaveTimerRef.current = null;
            }
        };
        // `save` intentionally reads the exact draft captured by this effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft, loading, busy]);

    useEffect(() => () => {
        if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    }, []);

    const onCreate = async () => {
        setBusy(true);
        setError('');
        try {
            await axios.post('/api/vault/llm-wiki/brain/create', {
                ui_locale: draft.ui_locale || 'en',
            });
            setConfirmCreate(false);
            await reload();
        } catch (err) {
            console.error('Could not create the standard Brain table:', err);
            setError(err.response?.data?.detail || tp('llm_wiki_create_error', { defaultValue: "The Brain table could not be created." }));
        } finally { setBusy(false); }
    };

    if (loading) {
        return <div style={{ padding: 14, fontSize: 12, color: 'var(--text-tertiary)' }}>{tp('llm_wiki_loading', { defaultValue: "Loading configuration…" })}</div>;
    }

    return (
        <>
          <div style={{
              marginTop: 8, padding: '12px 14px', borderRadius: 10,
              border: '1px dashed var(--border-primary, #e2e8f0)',
              background: 'var(--bg-primary, #fff)',
              display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                {tp('llm_wiki_intro_v2', { defaultValue: "Choose the Brain, one or more source tables, and the categorical fields that will maintain indexes." })}
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                    {tp('llm_wiki_table', { defaultValue: "Brain table" })}
                </span>
                <select
                    style={SELECT_STYLE}
                    value={draft.brain_table_id || ''}
                    disabled={busy}
                    onChange={(e) => onPickBrain(e.target.value)}
                >
                    <option value="">{tp('llm_wiki_none', { defaultValue: "None (disabled)" })}</option>
                    {sortFieldItems(tables, (table) => table.name || table.id).map((tbl) => (
                        <option key={tbl.id} value={tbl.id}>{tbl.name || tbl.id}</option>
                    ))}
                </select>
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button
                    type="button"
                    onClick={() => setConfirmCreate(true)}
                    disabled={busy}
                    style={{
                        padding: '8px 14px', borderRadius: 8, cursor: busy ? 'default' : 'pointer',
                        border: '1px solid var(--border-primary, #e2e8f0)',
                        background: 'var(--bg-secondary, #f8fafc)', fontWeight: 600,
                        color: 'var(--text-primary, #0f172a)', fontSize: 13, opacity: busy ? 0.6 : 1,
                    }}
                >
                    {tp('llm_wiki_create', { defaultValue: "Create a Brain table" })}
                </button>
                <span style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                    {serverState?.brain?.configured
                        ? tp('llm_wiki_active', { name: serverState.brain.name, defaultValue: `Actiu a «${serverState.brain.name}»` })
                        : tp('llm_wiki_inactive', { defaultValue: "No table designated yet." })}
                    {serverState?.brain?.configured && pendingSuggestions > 0 && (
                        <span style={{ marginLeft: 8, fontWeight: 700, color: 'var(--gnosi-primary, #6366f1)' }}>
                            {tp('llm_wiki_pending_connections', { count: pendingSuggestions, defaultValue: "{{count}} pending connections" })}
                        </span>
                    )}
                </span>
            </div>

            {brainTable && (
              <>
                <div style={{ borderTop: '1px solid var(--border-primary)', paddingTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                        {tp('llm_wiki_sources', { defaultValue: "Source tables" })}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 7 }}>
                        {tables.filter((table) => table.id !== draft.brain_table_id).map((table) => (
                            <label key={table.id} style={{
                                display: 'flex', gap: 7, alignItems: 'center', padding: '7px 9px',
                                border: '1px solid var(--border-primary)', borderRadius: 8, fontSize: 12,
                            }}>
                                <input
                                    type="checkbox"
                                    checked={selectedSourceIds.has(table.id)}
                                    onChange={() => toggleSource(table)}
                                />
                                {table.name || table.id}
                            </label>
                        ))}
                    </div>
                </div>

                <div>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                        {tp('llm_wiki_index_fields', { defaultValue: "Indexed categorical fields" })}
                    </div>
                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                        {categoricalProps.map((prop) => (
                            <label key={prop.id} style={{
                                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px',
                                border: '1px solid var(--border-primary)', borderRadius: 999, fontSize: 12,
                            }}>
                                <input
                                    type="checkbox"
                                    checked={(draft.index_field_ids || []).includes(prop.id)}
                                    onChange={() => toggleIndexField(prop.id)}
                                />
                                {prop.name || prop.id}
                            </label>
                        ))}
                        {categoricalProps.length === 0 && (
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                {tp('llm_wiki_no_index_fields', { defaultValue: "This table has no indexable categorical fields." })}
                            </span>
                        )}
                    </div>
                </div>

                {sortFieldItems(
                    draft.source_tables || [],
                    (source) => tables.find((table) => table.id === source.table_id)?.name || source.table_id,
                ).map((source) => {
                    const sourceTable = tables.find((table) => table.id === source.table_id);
                    const props = sortFieldItems(sourceTable?.properties || []);
                    const fileProps = sortFieldItems(props.filter((prop) => ['files', 'file', 'attachment', 'attachments'].includes(prop.type)));
                    const urlProps = sortFieldItems(props.filter((prop) => prop.type === 'url' || /url|enllaç|link/i.test(prop.name || '')));
                    return (
                      <div key={source.table_id} style={{ padding: 12, border: '1px solid var(--border-primary)', borderRadius: 9, background: 'var(--bg-secondary)' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 9 }}>{sourceTable?.name || source.table_id}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 9 }}>
                            <label style={{ fontSize: 11 }}>
                                {tp('llm_wiki_title_field', { defaultValue: "Title field" })}
                                <select
                                    style={{ ...SELECT_STYLE, marginTop: 3 }}
                                    value={source.title_property_id || ''}
                                    onChange={(event) => updateSource(source.table_id, (item) => ({ ...item, title_property_id: event.target.value }))}
                                >
                                    <option value="">—</option>
                                    {props.map((prop) => <option key={prop.id} value={prop.id}>{prop.name}</option>)}
                                </select>
                            </label>
                            <label style={{ fontSize: 11 }}>
                                {tp('llm_wiki_language_field', { defaultValue: "Language field" })}
                                <select
                                    style={{ ...SELECT_STYLE, marginTop: 3 }}
                                    value={source.language_property_id || ''}
                                    onChange={(event) => updateSource(source.table_id, (item) => ({ ...item, language_property_id: event.target.value }))}
                                >
                                    <option value="">{tp('llm_wiki_auto_language', { defaultValue: "Automatic detection" })}</option>
                                    {props.map((prop) => <option key={prop.id} value={prop.id}>{prop.name}</option>)}
                                </select>
                            </label>
                        </div>
                        <div style={{ marginTop: 9, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div>
                                <div style={{ fontSize: 11, fontWeight: 700 }}>{tp('llm_wiki_attachment_fields', { defaultValue: "Attachment fields" })}</div>
                                {fileProps.map((prop) => (
                                    <label key={prop.id} style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                                        <input
                                            type="checkbox"
                                            checked={(source.attachment_property_ids || []).includes(prop.id)}
                                            onChange={() => toggleInputProperty(source.table_id, 'attachment_property_ids', prop.id)}
                                        /> {prop.name}
                                    </label>
                                ))}
                            </div>
                            <div>
                                <div style={{ fontSize: 11, fontWeight: 700 }}>{tp('llm_wiki_url_fields', { defaultValue: "URL fields" })}</div>
                                {urlProps.map((prop) => (
                                    <label key={prop.id} style={{ display: 'block', fontSize: 11, marginTop: 4 }}>
                                        <input
                                            type="checkbox"
                                            checked={(source.url_property_ids || []).includes(prop.id)}
                                            onChange={() => toggleInputProperty(source.table_id, 'url_property_ids', prop.id)}
                                        /> {prop.name}
                                    </label>
                                ))}
                            </div>
                        </div>

                        {sortFieldItems(
                            draft.index_field_ids || [],
                            (fieldId) => brainTable.properties?.find((property) => property.id === fieldId)?.name || fieldId,
                        ).map((fieldId) => {
                            const brainProp = (brainTable.properties || []).find((prop) => prop.id === fieldId);
                            const mapping = source.dimension_mappings?.[fieldId] || { mode: 'ai', source_property_id: '', fixed_value: null };
                            const fixedOptions = serverState?.index_options?.[fieldId] || [];
                            return (
                                <div key={fieldId} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) 145px minmax(150px, 1fr)', gap: 8, alignItems: 'end', marginTop: 9 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600 }}>{brainProp?.name || fieldId}</span>
                                    <select
                                        style={SELECT_STYLE}
                                        value={mapping.mode}
                                        onChange={(event) => updateSource(source.table_id, (item) => ({
                                            ...item,
                                            dimension_mappings: {
                                                ...(item.dimension_mappings || {}),
                                                [fieldId]: { ...mapping, mode: event.target.value },
                                            },
                                        }))}
                                    >
                                        <option value="ai">{tp('llm_wiki_map_ai', { defaultValue: "Infer with AI" })}</option>
                                        <option value="source">{tp('llm_wiki_map_source', { defaultValue: "Copy source field" })}</option>
                                        <option value="fixed">{tp('llm_wiki_map_fixed', { defaultValue: "Fixed value" })}</option>
                                        <option value="empty">{tp('llm_wiki_map_empty', { defaultValue: "Leave empty" })}</option>
                                    </select>
                                    {mapping.mode === 'source' && (
                                        <select
                                            style={SELECT_STYLE}
                                            value={mapping.source_property_id || ''}
                                            onChange={(event) => updateSource(source.table_id, (item) => ({
                                                ...item,
                                                dimension_mappings: {
                                                    ...(item.dimension_mappings || {}),
                                                    [fieldId]: { ...mapping, source_property_id: event.target.value },
                                                },
                                            }))}
                                        >
                                            <option value="">—</option>
                                            {props.map((prop) => <option key={prop.id} value={prop.id}>{prop.name}</option>)}
                                        </select>
                                    )}
                                    {mapping.mode === 'fixed' && (
                                        <select
                                            style={SELECT_STYLE}
                                            value={(Array.isArray(mapping.fixed_value) ? mapping.fixed_value[0] : mapping.fixed_value) || ''}
                                            onChange={(event) => updateSource(source.table_id, (item) => ({
                                                ...item,
                                                dimension_mappings: {
                                                    ...(item.dimension_mappings || {}),
                                                    [fieldId]: { ...mapping, fixed_value: event.target.value },
                                                },
                                            }))}
                                        >
                                            <option value="">—</option>
                                            {fixedOptions.map((option) => (
                                                <option key={option.value} value={option.value}>{option.label}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                            );
                        })}
                      </div>
                    );
                })}
              </>
            )}

            {error && <div style={{ fontSize: 12, color: 'var(--status-error, #dc2626)' }}>{error}</div>}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', borderTop: '1px solid var(--border-primary)', paddingTop: 12 }}>
                <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                    {busy
                        ? tp('llm_wiki_saving', { defaultValue: 'Saving…' })
                        : tp('llm_wiki_autosave', { defaultValue: 'Changes save automatically.' })}
                </span>
                <button
                    type="button"
                    onClick={runLint}
                    disabled={lintBusy || !serverState?.validation?.valid}
                    className="btn-gnosi"
                >
                    {lintBusy ? tp('llm_wiki_lint_running', { defaultValue: "Reviewing…" }) : tp('llm_wiki_lint_run', { defaultValue: "Review the Brain (lint)" })}
                </button>
                <button
                    type="button"
                    onClick={runSemanticAudit}
                    disabled={semanticBusy || !serverState?.validation?.valid}
                    className="btn-gnosi"
                >
                    {semanticBusy
                        ? tp('llm_wiki_semantic_running', { defaultValue: "Analyzing connections…" })
                        : tp('llm_wiki_semantic_run', { defaultValue: "Propose connections with AI" })}
                </button>
            </div>

            {serverState?.capabilities && (
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                    <div>
                        {tp('llm_wiki_capabilities', {
                            ocr: serverState.capabilities.ocr ? '✓' : '—',
                            transcription: serverState.capabilities.transcription ? '✓' : '—',
                            streaming: serverState.capabilities.streaming ? '✓' : '—',
                            defaultValue: "OCR {{ocr}} · transcription {{transcription}} · streaming {{streaming}}",
                        })}
                    </div>
                    {(!serverState.capabilities.ocr
                        || !serverState.capabilities.transcription
                        || !serverState.capabilities.streaming
                        || (serverState.capabilities.ocr_missing_languages || []).length > 0) && (
                        <div style={{ marginTop: 3, color: 'var(--status-warning, #b45309)' }}>
                            {tp('llm_wiki_capability_help', {
                                defaultValue: "Install Tesseract (ca/es/en/fr), FFmpeg, and the Python dependencies locked with uv, then restart the native backend.",
                            })}
                            {(serverState.capabilities.ocr_missing_languages || []).length > 0 && (
                                <span style={{ display: 'block' }}>
                                    {tp('llm_wiki_missing_ocr_languages', {
                                        languages: serverState.capabilities.ocr_missing_languages.join(', '),
                                        defaultValue: "Missing OCR languages: {{languages}}.",
                                    })}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {lint && (
                <div style={{ fontSize: 12, color: 'var(--text-secondary, #475569)', lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary, #0f172a)', marginBottom: 4 }}>
                        {tp('llm_wiki_lint_summary', { count: lint.note_count, defaultValue: "{{count}} notes reviewed" })}
                    </div>
                    <div>• {tp('llm_wiki_lint_orphans', { count: lint.counts?.orphans || 0, defaultValue: "{{count}} orphans (no other note links them)" })}</div>
                    <div>• {tp('llm_wiki_lint_cites', { count: lint.counts?.broken_cites || 0, defaultValue: "{{count}} broken citations" })}</div>
                    <div>• {tp('llm_wiki_lint_indexes', { count: lint.counts?.index_drift || 0, defaultValue: "{{count}} pending indexes" })}</div>
                    <div>• {tp('llm_wiki_lint_reprocess', { count: lint.counts?.reprocess || 0, defaultValue: "{{count}} resources modified after processing" })}</div>
                </div>
            )}
          </div>
          <ConfirmModal
              isOpen={confirmCreate}
              onClose={() => setConfirmCreate(false)}
              onConfirm={onCreate}
              isDestructive={false}
              title={tp('llm_wiki_create_confirm_title', { defaultValue: "Create a standard Brain?" })}
              message={tp('llm_wiki_create_confirm_message', { defaultValue: "A table will be created with note type, areas, tags, position, and verification fields, plus the General index, Schema, and Log. No existing table will be removed or modified." })}
              confirmText={tp('llm_wiki_create_confirm', { defaultValue: "Create Brain" })}
          />
        </>
    );
}

/**
 * THIRD-PARTY plugins section (v2): plugins installed at `.gnosi/plugins/<id>/`
 * with their own manifest. Allows enabling/disabling, viewing and granting the
 * permissions they declare, and they run code in a sandbox (UI iframe / data Node). See
 * the `plugin_system.md` directive.
 */
function ThirdPartyPlugins({ section, installedFilter }) {
    const { t } = useTranslation();
    const tp = (k, opts) => t('settings.plugins.' + k, opts);
    const { isEnabled, setPluginEnabled, reload: reloadPluginState } = usePlugins();
    const [installed, setInstalled] = useState([]);
    const [catalog, setCatalog] = useState({});
    const [gallery, setGallery] = useState([]);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState('');
    const [lifecycleBusyId, setLifecycleBusyId] = useState(null);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [trustKeys, setTrustKeys] = useState([]);
    const [registryUrl, setRegistryUrl] = useState('');
    const [newKey, setNewKey] = useState({ name: '', public_key: '' });
    const [catalogSearch, setCatalogSearch] = useState('');
    const [catalogSource, setCatalogSource] = useState('all');
    const fileRef = React.useRef(null);

    // Doesn't do synchronous setState: `loading` already starts as true and is set to false at the end
    // (avoids cascading renders; cf. react-hooks/set-state-in-effect).
    const refresh = () => Promise.all([
        axios.get('/api/vault/plugins/installed').then((r) => r.data?.plugins || []).catch(() => []),
        axios.get('/api/vault/plugins/catalog').then((r) => r.data?.permissions || {}).catch(() => ({})),
        axios.get('/api/vault/plugins/catalog/list').then((r) => r.data?.catalog || []).catch(() => []),
        axios.get('/api/vault/plugins/trust').then((r) => r.data?.keys || []).catch(() => []),
        axios.get('/api/vault/plugins/registry-url').then((r) => r.data?.url || '').catch(() => ''),
    ]).then(([plugins, perms, gal, keys, regUrl]) => {
        setInstalled(plugins);
        setCatalog(perms);
        setGallery(gal);
        setTrustKeys(keys);
        setRegistryUrl(regUrl);
    }).finally(() => setLoading(false));

    useEffect(() => { refresh(); return undefined; }, []);

    const saveRegistryUrl = async () => {
        setError(''); setBusy('reg');
        try {
            await axios.put('/api/vault/plugins/registry-url', { url: registryUrl });
            await refresh();
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_save_url'));
        } finally { setBusy(''); }
    };

    const addTrustKey = async () => {
        if (!newKey.name.trim() || !newKey.public_key.trim()) return;
        setError(''); setBusy('key');
        try {
            await axios.post('/api/vault/plugins/trust', newKey);
            setNewKey({ name: '', public_key: '' });
            await refresh();
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_invalid_key'));
        } finally { setBusy(''); }
    };

    const removeTrustKey = async (name) => {
        setBusy(`key:${name}`);
        try {
            await axios.delete(`/api/vault/plugins/trust/${encodeURIComponent(name)}`);
            await refresh();
        } catch { /* noop */ } finally { setBusy(''); }
    };

    const togglePermission = async (pid, declared, current, perm) => {
        const has = current.includes(perm);
        const next = has ? current.filter((p) => p !== perm) : [...current, perm];
        // We only send permissions declared by the manifest (the backend also validates this).
        const clean = next.filter((p) => declared.includes(p));
        try {
            await axios.post(`/api/vault/plugins/${encodeURIComponent(pid)}/permissions`, { permissions: clean });
            refresh();
            reloadPlugins();
        } catch { /* noop */ }
    };

    const toggleThirdParty = async (pluginId, enabled) => {
        setError('');
        setLifecycleBusyId(pluginId);
        try {
            await setPluginEnabled(pluginId, enabled);
            await refresh();
            await reloadPlugins();
        } catch (err) {
            const message = tp('lifecycle_error');
            setError(message);
            notifyError('plugin-lifecycle', err, message);
        } finally {
            setLifecycleBusyId(null);
        }
    };

    const onInstallZip = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setError(''); setBusy('zip');
        try {
            const fd = new FormData();
            fd.append('file', file);
            await axios.post('/api/vault/plugins/install', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 0 });
            await refresh(); await reloadPluginState(); reloadPlugins();
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_install_plugin'));
        } finally { setBusy(''); }
    };

    const onInstallFromCatalog = async (id) => {
        setError(''); setBusy(`cat:${id}`);
        try {
            await axios.post('/api/vault/plugins/catalog/install', { id });
            await refresh(); await reloadPluginState(); reloadPlugins();
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_install'));
        } finally { setBusy(''); }
    };

    const onUninstall = async (id) => {
        setError(''); setBusy(`del:${id}`);
        try {
            await axios.delete(`/api/vault/plugins/${encodeURIComponent(id)}`);
            await refresh(); await reloadPluginState(); reloadPlugins();
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_uninstall'));
        } finally { setBusy(''); }
    };

    const onExport = async (id, version) => {
        setError(''); setNotice(''); setBusy(`export:${id}`);
        try {
            const response = await axios.post(
                `/api/vault/plugins/${encodeURIComponent(id)}/export`,
                {},
                { responseType: 'blob' },
            );
            const url = URL.createObjectURL(response.data);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `${id}-${version}.gnosi-plugin.zip`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_export'));
        } finally { setBusy(''); }
    };

    const onSubmit = async (id) => {
        setError(''); setNotice(''); setBusy(`submit:${id}`);
        try {
            await axios.post(`/api/vault/plugins/${encodeURIComponent(id)}/submissions`);
            setNotice(tp('submitted_for_review'));
        } catch (err) {
            setError(err?.response?.data?.detail || tp('error_submit'));
        } finally { setBusy(''); }
    };

    const visibleInstalled = installed.filter((plugin) => {
        const pluginId = plugin.manifest?.id || plugin.id;
        if (installedFilter === 'enabled') return isEnabled(pluginId);
        if (installedFilter === 'disabled') return !isEnabled(pluginId);
        return true;
    });
    const normalizedSearch = catalogSearch.trim().toLocaleLowerCase();
    const visibleGallery = gallery.filter((entry) => {
        const matchesSource = catalogSource === 'all'
            || (catalogSource === 'official' ? entry.source === 'bundled' : entry.source === 'url');
        const haystack = `${entry.name || ''} ${entry.description || ''} ${entry.author || ''}`.toLocaleLowerCase();
        return matchesSource && (!normalizedSearch || haystack.includes(normalizedSearch));
    });
    const installedVersions = new Map(installed
        .filter((plugin) => plugin.manifest?.id)
        .map((plugin) => [plugin.manifest.id, plugin.manifest.version]));
    const updates = gallery.filter((entry) => (
        installedVersions.has(entry.id)
        && isNewerVersion(entry.version, installedVersions.get(entry.id))
    ));

    return (
        <div style={{ marginTop: section === 'installed' ? 28 : 0 }}>
            {section === 'installed' && (
            <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Puzzle size={18} />
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{tp('third_party_title')}</h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary, #94a3b8)', marginBottom: 12 }}>
                <Trans i18nKey="settings.plugins.third_party_desc" components={{ code: <code /> }} />
            </p>

            {error && (
                <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca' }}>
                    {error}
                </div>
            )}
            {notice && (
                <div style={{ fontSize: 12, color: '#15803d', marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                    {notice}
                </div>
            )}

            {loading && <div style={{ fontSize: 13, color: 'var(--text-tertiary, #94a3b8)' }}>{tp('loading')}</div>}
            {!loading && visibleInstalled.length === 0 && (
                <div style={{
                    fontSize: 13, color: 'var(--text-tertiary, #94a3b8)', padding: '12px 14px',
                    borderRadius: 10, border: '1px dashed var(--border-primary, #e2e8f0)',
                }}>
                    {tp('installed_filter_empty')}
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibleInstalled.map((p) => {
                    if (!p.manifest) {
                        return (
                            <div key={p.id} style={{
                                padding: '12px 14px', borderRadius: 10, fontSize: 13, color: '#dc2626',
                                border: '1px solid #fecaca', background: '#fef2f2',
                            }}>
                                <Trans i18nKey="settings.plugins.broken_plugin" values={{ id: p.id, error: p.error }} components={{ b: <strong /> }} />
                            </div>
                        );
                    }
                    const m = p.manifest;
                    const enabled = isEnabled(m.id);
                    const granted = p.granted || [];
                    const declared = m.permissions || [];
                    return (
                        <div key={m.id} style={{
                            padding: '12px 14px', borderRadius: 10,
                            border: '1px solid var(--border-primary, #e2e8f0)',
                            background: 'var(--bg-secondary, #f8fafc)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                <Puzzle size={18} style={{ color: '#6366f1', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #0f172a)' }}>
                                        {m.name} <span style={{ fontSize: 11, color: 'var(--text-tertiary, #94a3b8)', fontWeight: 400 }}>v{m.version}</span>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                                        {m.description || tp('no_description')}{m.author ? ` · ${m.author}` : ''}
                                    </div>
                                    {p.provenance?.signedBy && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3, fontSize: 11, color: '#16a34a' }}>
                                            <ShieldCheck size={11} /> {tp('signed_by', { publisher: p.provenance.signedBy })}
                                        </div>
                                    )}
                                </div>
                                <button
                                    type="button" role="switch" aria-checked={enabled}
                                    onClick={() => toggleThirdParty(m.id, !enabled)}
                                    disabled={lifecycleBusyId === m.id}
                                    style={{
                                        position: 'relative', width: 42, height: 24, borderRadius: 999,
                                        border: 'none', cursor: 'pointer', flexShrink: 0,
                                        background: enabled ? '#6366f1' : 'var(--border-primary, #cbd5e1)',
                                        opacity: lifecycleBusyId === m.id ? 0.65 : 1,
                                    }}
                                    title={enabled ? tp('disable') : tp('enable')}
                                >
                                    <span style={{
                                        position: 'absolute', top: 2, left: enabled ? 20 : 2, width: 20, height: 20,
                                        borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                    }} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onExport(m.id, m.version)}
                                    disabled={busy === `export:${m.id}`}
                                    aria-label={tp('export_package')}
                                    title={tp('export_package')}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                        border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                                        background: 'transparent', color: 'var(--text-secondary)',
                                    }}
                                >
                                    {busy === `export:${m.id}` ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onSubmit(m.id)}
                                    disabled={busy === `submit:${m.id}`}
                                    aria-label={tp('submit_repository')}
                                    title={tp('submit_repository')}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                        border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                                        background: 'transparent', color: '#6366f1',
                                    }}
                                >
                                    {busy === `submit:${m.id}` ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onUninstall(m.id)}
                                    disabled={busy === `del:${m.id}`}
                                    aria-label={tp('uninstall')}
                                    title={tp('uninstall')}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                        border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                                        background: 'transparent', color: '#dc2626',
                                    }}
                                >
                                    <Trash2 size={15} />
                                </button>
                            </div>

                            {declared.length > 0 && (
                                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-tertiary, #94a3b8)' }}>
                                        {tp('permissions')}
                                    </span>
                                    {declared.map((perm) => (
                                        <label key={perm} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={granted.includes(perm)}
                                                onChange={() => togglePermission(m.id, declared, granted, perm)}
                                            />
                                            <code style={{ fontSize: 11 }}>{perm}</code>
                                            <span style={{ color: 'var(--text-tertiary, #94a3b8)' }}>{catalog[perm] || ''}</span>
                                        </label>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
            </>
            )}

            {section === 'catalog' && (
            <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <input ref={fileRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={onInstallZip} />
                <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    disabled={busy === 'zip'}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
                        border: '1px solid var(--border-primary, #e2e8f0)', cursor: busy === 'zip' ? 'wait' : 'pointer',
                        background: 'var(--bg-primary, #fff)', color: 'var(--text-primary, #0f172a)', fontSize: 13, fontWeight: 600,
                    }}
                >
                    <Upload size={15} /> {busy === 'zip' ? tp('installing') : tp('install_zip')}
                </button>
            </div>
            {error && (
                <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca' }}>
                    {error}
                </div>
            )}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <label style={{ position: 'relative', flex: '1 1 240px' }}>
                    <Search size={15} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--text-tertiary)' }} />
                    <input
                        type="search"
                        value={catalogSearch}
                        onChange={(event) => setCatalogSearch(event.target.value)}
                        placeholder={tp('catalog_search_placeholder')}
                        style={{ ...SELECT_STYLE, paddingLeft: 32 }}
                    />
                </label>
                <select value={catalogSource} onChange={(event) => setCatalogSource(event.target.value)} style={{ ...SELECT_STYLE, width: 170 }}>
                    <option value="all">{tp('catalog_source_all')}</option>
                    <option value="official">{tp('catalog_source_official')}</option>
                    <option value="community">{tp('catalog_source_community')}</option>
                </select>
            </div>

            {visibleGallery.length > 0 && (
                <div style={{ marginTop: 22 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <Download size={16} />
                        <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{tp('gallery')}</h4>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {visibleGallery.map((g) => (
                            <div key={g.id} style={{
                                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10,
                                border: '1px solid var(--border-primary, #e2e8f0)', background: 'var(--bg-primary, #fff)',
                            }}>
                                <Puzzle size={16} style={{ color: '#6366f1', flexShrink: 0 }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #0f172a)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {g.name}
                                        {g.signed && (
                                            <span title={tp('signed_tip')} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: '#16a34a' }}>
                                                <ShieldCheck size={12} /> {tp('signed')}
                                            </span>
                                        )}
                                        {g.source === 'url' && !g.signed && (
                                            <span title={tp('unsigned_tip')} style={{ fontSize: 10, fontWeight: 600, color: '#d97706' }}>{tp('not_verified')}</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>{g.description}</div>
                                </div>
                                {g.installed ? (
                                    <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600, flexShrink: 0 }}>{tp('installed')}</span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => onInstallFromCatalog(g.id)}
                                        disabled={busy === `cat:${g.id}`}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 8, flexShrink: 0,
                                            border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                                            background: 'var(--bg-secondary, #f8fafc)', color: 'var(--text-primary, #0f172a)', fontSize: 12, fontWeight: 600,
                                        }}
                                    >
                                        <Download size={14} /> {busy === `cat:${g.id}` ? tp('installing') : tp('install')}
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {!loading && visibleGallery.length === 0 && (
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', padding: '18px', textAlign: 'center' }}>
                    {tp('catalog_empty')}
                </div>
            )}

            <div style={{ marginTop: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Globe size={16} />
                    <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>{tp('remote_title')}</h4>
                </div>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                        {tp('registry_url_label')}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            type="url" placeholder="https://github.com/ismigar/Gnosi/releases/latest/download/plugins-index.json"
                            value={registryUrl}
                            onChange={(e) => setRegistryUrl(e.target.value)}
                            style={{ ...SELECT_STYLE, flex: 1 }}
                        />
                        <button
                            type="button" onClick={saveRegistryUrl} disabled={busy === 'reg'}
                            style={{
                                padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                                border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                                background: 'var(--bg-secondary, #f8fafc)', color: 'var(--text-primary, #0f172a)',
                            }}
                        >{tp('save')}</button>
                    </div>
                </label>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <KeyRound size={14} style={{ color: 'var(--text-tertiary, #94a3b8)' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary, #475569)' }}>
                        {tp('trust_keys')}
                    </span>
                </div>
                {trustKeys.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)', marginBottom: 8 }}>
                        {tp('no_trust_keys')}
                    </div>
                )}
                {trustKeys.map((k) => (
                    <div key={k.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
                        <ShieldCheck size={13} style={{ color: '#16a34a', flexShrink: 0 }} />
                        <span style={{ fontWeight: 600 }}>{k.name}</span>
                        <code style={{ fontSize: 11, color: 'var(--text-tertiary, #94a3b8)' }}>{k.fingerprint}…</code>
                        <button
                            type="button" onClick={() => removeTrustKey(k.name)}
                            aria-label={tp('remove')} title={tp('remove')}
                            style={{ marginLeft: 'auto', border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer' }}
                        ><Trash2 size={13} /></button>
                    </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <input
                        type="text" placeholder={tp('publisher_placeholder')}
                        value={newKey.name}
                        onChange={(e) => setNewKey((k) => ({ ...k, name: e.target.value }))}
                        style={{ ...SELECT_STYLE, width: 160 }}
                    />
                    <input
                        type="text" placeholder={tp('pubkey_placeholder')}
                        value={newKey.public_key}
                        onChange={(e) => setNewKey((k) => ({ ...k, public_key: e.target.value }))}
                        style={{ ...SELECT_STYLE, flex: 1 }}
                    />
                    <button
                        type="button" onClick={addTrustKey} disabled={busy === 'key'}
                        style={{
                            padding: '8px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                            border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                            background: 'var(--bg-secondary, #f8fafc)', color: 'var(--text-primary, #0f172a)',
                        }}
                    >{tp('add')}</button>
                </div>
            </div>
            </>
            )}

            {section === 'updates' && (
                <div>
                    {loading && <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>{tp('loading')}</div>}
                    {!loading && updates.length === 0 && (
                        <div style={{ padding: '26px 18px', textAlign: 'center', border: '1px dashed var(--border-primary)', borderRadius: 12 }}>
                            <RefreshCw size={24} style={{ color: '#16a34a', marginBottom: 8 }} />
                            <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{tp('updates_empty_title')}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>{tp('updates_empty_desc')}</div>
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {updates.map((entry) => (
                            <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid var(--border-primary)', borderRadius: 10 }}>
                                <RefreshCw size={17} style={{ color: '#6366f1' }} />
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 14, fontWeight: 700 }}>{entry.name}</div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                        v{installedVersions.get(entry.id)} → v{entry.version}
                                    </div>
                                </div>
                                <button type="button" className="btn-gnosi-secondary" onClick={() => onInstallFromCatalog(entry.id)} disabled={busy === `cat:${entry.id}`}>
                                    <RefreshCw size={14} /> {busy === `cat:${entry.id}` ? tp('installing') : tp('update')}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Plugin configuration panel: enables/disables the optional features
 * (internal registry). State is persisted per vault in `.gnosi/plugins.json`.
 */
export function PluginsSettings({ onOpenSettingsTab, initialPluginId = null }) {
    const { t } = useTranslation();
    const tp = (k, opts) => t('settings.plugins.' + k, opts);
    const { builtins, isEnabled, setPluginEnabled } = usePlugins();
    const builtinCatalog = builtins?.length ? builtins : BUILTIN_PLUGINS;
    const [section, setSection] = useState('installed');
    const [installedFilter, setInstalledFilter] = useState('all');
    const [pendingLifecycle, setPendingLifecycle] = useState(null);
    const [busyPluginIds, setBusyPluginIds] = useState(() => new Set());
    const [configuredPluginId, setConfiguredPluginId] = useState(null);

    const inlineConfigComponents = {
        'daily-notes': DailyNotesConfig,
        'web-clipper': WebClipperConfig,
        'project-planning': ProjectPlanningConfig,
        'llm-wiki': LlmWikiConfig,
        'resources': ResourcesPluginConfig,
    };

    useEffect(() => {
        let targetPluginId = initialPluginId;
        if (!targetPluginId) {
            try {
                targetPluginId = window.sessionStorage.getItem('gnosi:configure-plugin');
                if (targetPluginId) {
                    window.sessionStorage.removeItem('gnosi:configure-plugin');
                }
            } catch {
                // Ignore storage errors.
            }
        }
        if (targetPluginId) {
            setSection('installed');
            setInstalledFilter('all');
            setConfiguredPluginId(targetPluginId);
            const timer = window.setTimeout(() => {
                const el = document.getElementById(`settings-plugin-${targetPluginId}`);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 120);
            return () => window.clearTimeout(timer);
        }
    }, [initialPluginId]);

    const openPluginConfiguration = (plugin) => {
        if (inlineConfigComponents[plugin.id]) {
            setConfiguredPluginId((current) => current === plugin.id ? null : plugin.id);
            return;
        }
        onOpenSettingsTab?.(plugin.settingsTab, plugin.id);
    };

    const togglePlugin = async (pluginId, enabled) => {
        if (busyPluginIds.has(pluginId)) return;
        setBusyPluginIds((current) => new Set(current).add(pluginId));
        try {
            await setPluginEnabled(pluginId, enabled);
        } catch (error) {
            const conflict = error?.response?.status === 409 ? error.response.data?.detail : null;
            if (conflict?.code === 'plugin_dependency_confirmation_required') {
                setPendingLifecycle({ pluginId, enabled, ...conflict });
                return;
            }
            notifyError('plugin-lifecycle', error, tp('lifecycle_error'));
        } finally {
            setBusyPluginIds((current) => {
                const next = new Set(current);
                next.delete(pluginId);
                return next;
            });
        }
    };

    const confirmLifecycle = async () => {
        if (!pendingLifecycle) return;
        const pluginId = pendingLifecycle.pluginId;
        setBusyPluginIds((current) => new Set(current).add(pluginId));
        try {
            await setPluginEnabled(pluginId, pendingLifecycle.enabled, {
                confirmDependencies: pendingLifecycle.enabled,
                confirmDisable: !pendingLifecycle.enabled,
            });
            setPendingLifecycle(null);
        } catch (error) {
            notifyError('plugin-lifecycle', error, tp('lifecycle_error'));
        } finally {
            setBusyPluginIds((current) => {
                const next = new Set(current);
                next.delete(pluginId);
                return next;
            });
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Puzzle size={18} />
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>{tp('title')}</h3>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary, #94a3b8)', marginBottom: 16 }}>
                {tp('desc')}
            </p>

            <SettingsSectionTabs
                ariaLabel={tp('sections_label')}
                activeId={section}
                onChange={setSection}
                items={[
                    { id: 'installed', icon: PackageCheck, label: tp('installed_tab') },
                    { id: 'catalog', icon: Store, label: tp('catalog_tab') },
                    { id: 'updates', icon: RefreshCw, label: tp('updates_tab') },
                ]}
            />

            {section === 'installed' && (
            <>
            <div className="settings-filter-tabs" role="group" aria-label={tp('installed_filters_label')}>
                {['all', 'enabled', 'disabled'].map((filter) => (
                    <button
                        key={filter}
                        type="button"
                        className={installedFilter === filter ? 'is-active' : ''}
                        aria-pressed={installedFilter === filter}
                        onClick={() => setInstalledFilter(filter)}
                    >
                        {tp(`filter_${filter}`)}
                    </button>
                ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {builtinCatalog.filter((plugin) => (
                    installedFilter === 'all'
                    || (installedFilter === 'enabled' ? isEnabled(plugin.id) : !isEnabled(plugin.id))
                )).map((plugin) => {
                    const Icon = ICONS[plugin.icon] || Puzzle;
                    const enabled = isEnabled(plugin.id);
                    const hasSettings = Boolean(plugin.settingsTab);
                    const InlineConfig = inlineConfigComponents[plugin.id];
                    const isConfigOpen = configuredPluginId === plugin.id;
                    return (
                        <div
                            key={plugin.id}
                            id={`settings-plugin-${plugin.id}`}
                            className="settings-plugin-item"
                            style={{
                                display: 'flex', flexDirection: 'column', gap: 0,
                                padding: '12px 14px', borderRadius: 10,
                                border: '1px solid var(--border-primary, #e2e8f0)',
                                background: 'var(--bg-secondary, #f8fafc)',
                            }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <Icon size={18} style={{ color: '#6366f1', flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary, #0f172a)' }}>
                                    {tp(`catalog.${plugin.id}.name`)}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--text-tertiary, #94a3b8)' }}>
                                    {tp(`catalog.${plugin.id}.description`)}
                                </div>
                            </div>
                            {hasSettings && enabled && (
                                <button
                                    type="button"
                                    onClick={() => openPluginConfiguration(plugin)}
                                    aria-label={tp('configure')}
                                    aria-expanded={InlineConfig ? isConfigOpen : undefined}
                                    title={tp('configure')}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                                        border: '1px solid var(--border-primary, #e2e8f0)', cursor: 'pointer',
                                        background: 'transparent',
                                        color: 'var(--text-tertiary, #94a3b8)',
                                    }}
                                >
                                    <Settings size={16} />
                                </button>
                            )}
                            <button
                                type="button"
                                role="switch"
                                aria-checked={enabled}
                                onClick={() => togglePlugin(plugin.id, !enabled)}
                                disabled={busyPluginIds.has(plugin.id)}
                                style={{
                                    position: 'relative', width: 42, height: 24, borderRadius: 999,
                                    border: 'none', cursor: 'pointer', flexShrink: 0,
                                    background: enabled ? '#6366f1' : 'var(--border-primary, #cbd5e1)',
                                    transition: 'background 0.15s',
                                    opacity: busyPluginIds.has(plugin.id) ? 0.65 : 1,
                                }}
                                title={enabled ? tp('disable') : tp('enable')}
                            >
                                <span
                                    style={{
                                        position: 'absolute', top: 2, left: enabled ? 20 : 2,
                                        width: 20, height: 20, borderRadius: '50%', background: '#fff',
                                        transition: 'left 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                    }}
                                />
                            </button>
                          </div>
                          {InlineConfig && isConfigOpen && <InlineConfig />}
                        </div>
                    );
                })}
            </div>
            </>
            )}

            <ConfirmModal
                isOpen={Boolean(pendingLifecycle)}
                onClose={() => setPendingLifecycle(null)}
                onConfirm={confirmLifecycle}
                title={tp('dependency_confirm_title', { defaultValue: "Change related plugins?" })}
                message={pendingLifecycle?.enabled
                    ? tp('dependency_enable_message', {
                        defaultValue: "This feature also needs: {{plugins}}. They will be activated together.",
                        plugins: (pendingLifecycle?.enable || []).join(', '),
                    })
                    : tp('dependency_disable_message', {
                        defaultValue: "These dependent features will also be disabled: {{plugins}}. Their data and settings will be preserved.",
                        plugins: (pendingLifecycle?.disable || []).join(', '),
                    })}
                confirmText={tp('dependency_confirm_action', { defaultValue: "Confirm change" })}
                isDestructive={!pendingLifecycle?.enabled}
            />

            <ThirdPartyPlugins section={section} installedFilter={installedFilter} />
        </div>
    );
}

export default PluginsSettings;

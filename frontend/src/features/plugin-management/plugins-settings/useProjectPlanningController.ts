import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { logError } from '../../../shared/notifications/notifyError';
import { usePlugins } from '../../../shared/plugins/usePlugins';
import {
    createPlanningAssignment,
    createPlanningCalendar,
    createPlanningResource,
    deletePlanningAssignment,
    deletePlanningCalendar,
    deletePlanningResource,
    fetchPlanningLevelingPreview,
    updatePlanningCalendar,
    type PlanningCalendarInput,
    type PlanningLevelingPreview,
    type PlanningResourceInput,
} from '../../../shared/api/planning';
import { usePlanningState } from '../../../shared/api/usePlanningData';
import {
    fetchVaultPagesByTable,
    fetchVaultTables,
    type VaultPageSummary,
} from '../../../shared/api/vaults';
import { sortFieldItems } from '../../../shared/schema/fieldOrdering';
import {
    apiErrorMessage,
    isRecord,
    normalizeVaultTables,
    numberSetting,
    settingsRecord,
    stringArraySetting,
    stringSetting,
    type VaultTable,
} from './pluginSettingsModel';
import {
    EMPTY_ASSIGNMENT,
    EMPTY_RESOURCE,
    holidayRowsForYear,
    isValidIsoDate,
    planningAssignment,
    type AssignmentDraft,
    type HolidayRow,
    type ProjectPlanningController,
} from './projectPlanningModel';

function numberList(value: unknown): number[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is number => typeof item === 'number');
}

function descriptions(value: unknown): Readonly<Record<string, string>> {
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
    ));
}

export function useProjectPlanningController(): ProjectPlanningController {
    const { t, i18n } = useTranslation();
    const { getPluginSettings, setPluginSettings } = usePlugins();
    const config = settingsRecord(getPluginSettings('project-planning'));
    const defaultHolidayYear = new Date().getFullYear();
    const configuredHolidayYear = numberSetting(config, 'holiday_year', defaultHolidayYear);
    const configuredHolidays = useMemo(() => stringArraySetting(config, 'holidays'), [config]);
    const configuredDescriptions = useMemo(() => descriptions(config.holiday_descriptions), [config]);
    const [tables, setTables] = useState<readonly VaultTable[]>([]);
    const [loading, setLoading] = useState(true);
    const [projectPages, setProjectPages] = useState<readonly VaultPageSummary[]>([]);
    const [taskPages, setTaskPages] = useState<readonly VaultPageSummary[]>([]);
    const [holidayYear, setHolidayYear] = useState(configuredHolidayYear);
    const [holidayYearInput, setHolidayYearInput] = useState(String(configuredHolidayYear));
    const [holidayRows, setHolidayRows] = useState<readonly HolidayRow[]>(() => (
        holidayRowsForYear(configuredHolidays, configuredDescriptions, configuredHolidayYear)
    ));
    const [hoursPerDayInput, setHoursPerDayInput] = useState(
        String(numberSetting(config, 'hours_per_day', 8)),
    );
    const [planningError, setPlanningError] = useState('');
    const [resourceDraft, setResourceDraft] = useState<PlanningResourceInput>(EMPTY_RESOURCE);
    const [calendarDraft, setCalendarDraft] = useState('');
    const [assignmentDraft, setAssignmentDraft] = useState<AssignmentDraft>(EMPTY_ASSIGNMENT);
    const [levelingProposal, setLevelingProposal] = useState<PlanningLevelingPreview | null>(null);
    const {
        data: planningState,
        error: planningStateError,
        isFetching: planningLoading,
        refetch: refetchPlanning,
    } = usePlanningState();

    const translate = (key: string, fallback: string): string => (
        t(`settings.plugins.${key}`, { defaultValue: fallback })
    );

    const refreshPlanning = async (): Promise<void> => {
        try {
            const result = await refetchPlanning();
            if (result.error) throw result.error;
            setPlanningError('');
        } catch (error) {
            logError('project-planning.load-resources', error);
            setPlanningError(translate('planning_resources_load_error', 'Could not load planning resources.'));
        }
    };

    useEffect(() => {
        let alive = true;
        void fetchVaultTables()
            .then((records) => {
                if (alive) setTables(normalizeVaultTables(records));
            })
            .catch((error: unknown) => {
                logError('project-planning.load-tables', error);
                if (alive) setTables([]);
            })
            .finally(() => {
                if (alive) setLoading(false);
            });
        return () => {
            alive = false;
        };
    }, []);

    const taskTableId = stringSetting(config, 'task_table_id');
    const projectTableId = stringSetting(config, 'project_table_id');

    useEffect(() => {
        if (!taskTableId) return undefined;
        let alive = true;
        void fetchVaultPagesByTable(taskTableId, { include_templates: false })
            .then((pages) => {
                if (alive) setTaskPages(pages);
            })
            .catch((error: unknown) => {
                logError('project-planning.load-task-pages', error);
                if (alive) setTaskPages([]);
            });
        return () => {
            alive = false;
        };
    }, [taskTableId]);

    useEffect(() => {
        if (!projectTableId) return undefined;
        let alive = true;
        void fetchVaultPagesByTable(projectTableId, { include_templates: false })
            .then((pages) => {
                if (alive) setProjectPages(pages);
            })
            .catch((error: unknown) => {
                logError('project-planning.load-project-pages', error);
                if (alive) setProjectPages([]);
            });
        return () => {
            alive = false;
        };
    }, [projectTableId]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setHolidayYear(configuredHolidayYear);
            setHolidayYearInput(String(configuredHolidayYear));
            setHolidayRows(holidayRowsForYear(
                configuredHolidays,
                configuredDescriptions,
                configuredHolidayYear,
            ));
        }, 0);
        return () => {
            clearTimeout(timer);
        };
    }, [configuredDescriptions, configuredHolidayYear, configuredHolidays]);

    const configuredHours = numberSetting(config, 'hours_per_day', 8);
    useEffect(() => {
        const timer = setTimeout(() => {
            setHoursPerDayInput(String(configuredHours));
        }, 0);
        return () => {
            clearTimeout(timer);
        };
    }, [configuredHours]);

    const setPlanningSettings = (patch: Readonly<Record<string, unknown>>): void => {
        void setPluginSettings('project-planning', patch);
        if (patch.project_table_id === '') {
            setAssignmentDraft((current) => ({ ...current, project_id: '' }));
        }
        const calendar: PlanningCalendarInput = {};
        if (Object.hasOwn(patch, 'working_weekdays') && Array.isArray(patch.working_weekdays)) {
            calendar.working_weekdays = numberList(patch.working_weekdays);
        }
        if (Object.hasOwn(patch, 'holidays') && Array.isArray(patch.holidays)) {
            calendar.holidays = patch.holidays.filter((item): item is string => typeof item === 'string');
        }
        if (typeof patch.hours_per_day === 'number') calendar.hours_per_day = patch.hours_per_day;
        if (typeof patch.workday_start === 'string') calendar.workday_start = patch.workday_start;
        if (Object.keys(calendar).length > 0) {
            void updatePlanningCalendar({ calendarId: 'project-default', calendar })
                .then(refreshPlanning)
                .catch((error: unknown) => {
                    logError('project-planning.sync-calendar', error);
                });
        }
    };

    const workingWeekdays = numberList(config.working_weekdays);
    const effectiveWeekdays = workingWeekdays.length > 0 ? workingWeekdays : [1, 2, 3, 4, 5];

    const toggleWeekday = (day: number): void => {
        const next = effectiveWeekdays.includes(day)
            ? effectiveWeekdays.filter((candidate) => candidate !== day)
            : [...effectiveWeekdays, day];
        if (next.length > 0) setPlanningSettings({ working_weekdays: next });
    };

    const commitHolidayYear = (value: string): void => {
        const nextYear = Math.min(2200, Math.max(1900, Number(value) || defaultHolidayYear));
        setHolidayYear(nextYear);
        setHolidayYearInput(String(nextYear));
        setHolidayRows(holidayRowsForYear(configuredHolidays, configuredDescriptions, nextYear));
        setPlanningSettings({ holiday_year: nextYear });
    };

    const commitHoursPerDay = (value: string): void => {
        const parsed = Number(value.replace(',', '.'));
        const fallback = numberSetting(config, 'hours_per_day', 8);
        const nextHours = Math.min(24, Math.max(0.25, Number.isFinite(parsed) ? parsed : fallback));
        setHoursPerDayInput(String(nextHours));
        setPlanningSettings({ hours_per_day: nextHours });
    };

    const saveHolidays = (rows: readonly HolidayRow[] = holidayRows): void => {
        const yearPrefix = `${String(holidayYear)}-`;
        const holidaysForYear = rows
            .map((row) => ({ date: row.date.trim(), description: row.description.trim() }))
            .filter((row) => row.date.startsWith(yearPrefix) && isValidIsoDate(row.date))
            .filter((row, index, allRows) => allRows.findIndex((candidate) => candidate.date === row.date) === index)
            .sort((left, right) => left.date.localeCompare(right.date));
        const existing = configuredHolidays.filter((holiday) => !holiday.startsWith(yearPrefix));
        const nextDescriptions = Object.fromEntries(Object.entries(configuredDescriptions)
            .filter(([date, description]) => !date.startsWith(yearPrefix) && description.trim()));
        holidaysForYear.forEach(({ date, description }) => {
            if (description) nextDescriptions[date] = description;
        });
        const holidays = [...new Set([...existing, ...holidaysForYear.map(({ date }) => date)])].sort();
        setHolidayRows(holidaysForYear);
        setPlanningSettings({
            holiday_descriptions: nextDescriptions,
            holiday_year: holidayYear,
            holidays,
        });
    };

    const captureError = (error: unknown, key: string, fallback: string): void => {
        setPlanningError(apiErrorMessage(error, translate(key, fallback)));
    };

    const createResource = async (): Promise<void> => {
        try {
            await createPlanningResource(resourceDraft);
            setResourceDraft(EMPTY_RESOURCE);
            await refreshPlanning();
        } catch (error) {
            captureError(error, 'planning_resource_save_error', 'Could not save the resource.');
        }
    };

    const createCalendar = async (): Promise<void> => {
        try {
            await createPlanningCalendar({
                holidays: [...configuredHolidays],
                hours_per_day: numberSetting(config, 'hours_per_day', 8),
                name: calendarDraft,
                workday_start: stringSetting(config, 'workday_start') || '09:00',
                working_weekdays: [...effectiveWeekdays],
            });
            setCalendarDraft('');
            await refreshPlanning();
        } catch (error) {
            captureError(error, 'planning_calendar_save_error', 'Could not save the calendar.');
        }
    };

    const removeAndRefresh = async (
        remove: () => Promise<unknown>,
        key: string,
        fallback: string,
    ): Promise<void> => {
        try {
            await remove();
            await refreshPlanning();
        } catch (error) {
            captureError(error, key, fallback);
        }
    };

    const createAssignment = async (): Promise<void> => {
        try {
            await createPlanningAssignment(planningAssignment(assignmentDraft));
            setAssignmentDraft(EMPTY_ASSIGNMENT);
            await refreshPlanning();
        } catch (error) {
            captureError(error, 'planning_assignment_save_error', 'Could not save the assignment.');
        }
    };

    const previewLeveling = async (): Promise<void> => {
        try {
            setLevelingProposal(await fetchPlanningLevelingPreview());
            setPlanningError('');
        } catch (error) {
            captureError(error, 'planning_leveling_load_error', 'Could not generate the leveling proposal.');
        }
    };

    const activeProjectPages = projectTableId ? projectPages : [];
    const activeTaskPages = taskTableId ? taskPages : [];
    const sortedTables = sortFieldItems(tables, (table) => table.name, i18n.language);
    const sortedProjects = sortFieldItems(activeProjectPages, (page) => page.title, i18n.language);
    const sortedTasks = sortFieldItems(activeTaskPages, (page) => page.title, i18n.language);

    return {
        addHolidayRow: () => { setHolidayRows((current) => [...current, { date: '', description: '' }]); },
        assignmentDraft,
        calendarDraft,
        commitHolidayYear,
        commitHoursPerDay,
        config,
        createAssignment,
        createCalendar,
        createResource,
        deleteAssignment: (id) => removeAndRefresh(() => deletePlanningAssignment(id), 'planning_assignment_delete_error', 'Could not delete the assignment.'),
        deleteCalendar: (id) => removeAndRefresh(() => deletePlanningCalendar(id), 'planning_calendar_delete_error', 'Could not delete the calendar.'),
        deleteResource: (id) => removeAndRefresh(() => deletePlanningResource(id), 'planning_resource_delete_error', 'Could not delete the resource.'),
        holidayRows,
        holidayYear,
        holidayYearInput,
        hoursPerDayInput,
        levelingProposal,
        loading,
        planningError: planningError || (planningStateError ? translate('planning_resources_load_error', 'Could not load planning resources.') : ''),
        planningLoading,
        planningState,
        previewLeveling,
        projectPages: activeProjectPages,
        removeHolidayRow: (index) => {
            const rows = holidayRows.filter((_row, rowIndex) => rowIndex !== index);
            setHolidayRows(rows);
            saveHolidays(rows);
        },
        resourceDraft,
        saveHolidays,
        setAssignmentDraft,
        setCalendarDraft,
        setHolidayYearInput,
        setHoursPerDayInput,
        setPlanningSettings,
        setResourceDraft,
        sortedProjects,
        sortedTables,
        sortedTasks,
        tables,
        taskPages: activeTaskPages,
        toggleWeekday,
        updateHolidayRow: (index, field, value) => {
            setHolidayRows((current) => current.map((row, rowIndex) => (
                rowIndex === index ? { ...row, [field]: value } : row
            )));
        },
        workingWeekdays: effectiveWeekdays,
    };
}

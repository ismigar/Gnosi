import type {
    PlanningAssignmentInput,
    PlanningLevelingPreview,
    PlanningResourceInput,
    PlanningState,
} from '../../shared/api/planning';
import type { VaultPageSummary } from '../../shared/api/vaults';
import type { VaultTable } from './pluginSettingsModel';

export interface HolidayRow {
    readonly date: string;
    readonly description: string;
}

export interface AssignmentDraft {
    readonly end: string;
    readonly planned_work_hours: number | string;
    readonly project_id: string;
    readonly resource_id: string;
    readonly start: string;
    readonly task_id: string;
}

export interface ProjectPlanningController {
    readonly assignmentDraft: AssignmentDraft;
    readonly calendarDraft: string;
    readonly config: Readonly<Record<string, unknown>>;
    readonly createAssignment: () => Promise<void>;
    readonly createCalendar: () => Promise<void>;
    readonly createResource: () => Promise<void>;
    readonly deleteAssignment: (id: string) => Promise<void>;
    readonly deleteCalendar: (id: string) => Promise<void>;
    readonly deleteResource: (id: string) => Promise<void>;
    readonly holidayRows: readonly HolidayRow[];
    readonly holidayYear: number;
    readonly holidayYearInput: string;
    readonly hoursPerDayInput: string;
    readonly levelingProposal: PlanningLevelingPreview | null;
    readonly loading: boolean;
    readonly planningError: string;
    readonly planningLoading: boolean;
    readonly planningState: PlanningState | undefined;
    readonly previewLeveling: () => Promise<void>;
    readonly projectPages: readonly VaultPageSummary[];
    readonly resourceDraft: PlanningResourceInput;
    readonly saveHolidays: (rows?: readonly HolidayRow[]) => void;
    readonly setAssignmentDraft: (draft: AssignmentDraft) => void;
    readonly setCalendarDraft: (value: string) => void;
    readonly setHolidayYearInput: (value: string) => void;
    readonly setHoursPerDayInput: (value: string) => void;
    readonly setPlanningSettings: (patch: Readonly<Record<string, unknown>>) => void;
    readonly setResourceDraft: (draft: PlanningResourceInput) => void;
    readonly sortedProjects: readonly VaultPageSummary[];
    readonly sortedTables: readonly VaultTable[];
    readonly sortedTasks: readonly VaultPageSummary[];
    readonly tables: readonly VaultTable[];
    readonly taskPages: readonly VaultPageSummary[];
    readonly updateHolidayRow: (index: number, field: keyof HolidayRow, value: string) => void;
    readonly addHolidayRow: () => void;
    readonly removeHolidayRow: (index: number) => void;
    readonly commitHolidayYear: (value: string) => void;
    readonly commitHoursPerDay: (value: string) => void;
    readonly toggleWeekday: (day: number) => void;
    readonly workingWeekdays: readonly number[];
}

export const EMPTY_ASSIGNMENT: AssignmentDraft = {
    end: '', planned_work_hours: 0, project_id: '', resource_id: '', start: '', task_id: '',
};

export const EMPTY_RESOURCE: PlanningResourceInput = {
    availability_units: 100,
    calendar_id: 'project-default',
    name: '',
    standard_rate: 0,
    type: 'work',
};

export function isValidIsoDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

export function holidayRowsForYear(
    holidays: readonly string[],
    descriptions: Readonly<Record<string, string>>,
    year: number,
): HolidayRow[] {
    return holidays
        .filter((date) => date.startsWith(`${String(year)}-`) && isValidIsoDate(date))
        .sort()
        .map((date) => ({ date, description: descriptions[date] ?? '' }));
}

export function planningAssignment(draft: AssignmentDraft): PlanningAssignmentInput {
    return {
        ...draft,
        end: draft.end || null,
        planned_work_hours: Number(draft.planned_work_hours) || 0,
        project_id: draft.project_id || null,
        start: draft.start || null,
    };
}

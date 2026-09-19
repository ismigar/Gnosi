export interface CalendarSchedule {
    kind: 'interval' | 'daily' | 'weekly';
    time: string;
    timezone: string;
    weekdays: number[];
}

export const defaultSchedule = (): CalendarSchedule => ({ kind: 'interval', time: '08:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', weekdays: [0] });


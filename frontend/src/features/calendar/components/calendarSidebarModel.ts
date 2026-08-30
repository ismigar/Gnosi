export const CALENDAR_COLORS = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#f97316',
  '#71717a',
  '#1e293b',
] as const;


export interface CalendarSourceConfig {
  readonly account?: string | null;
  readonly color?: string | null;
  readonly name?: string | null;
  readonly source: string;
}


export interface CalendarGridDay {
  readonly date: Date;
  readonly isCurrent: boolean;
  readonly isToday: boolean;
  readonly num: number;
}


export interface CalendarSourceEntry {
  readonly config?: CalendarSourceConfig;
  readonly source: string;
}


export interface CalendarSourceGroup {
  readonly account: string;
  readonly calendars: readonly CalendarSourceEntry[];
}


export function buildCalendarGrid(
  currentDate: Date,
  today: Date = new Date(),
): CalendarGridDay[] {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPreviousMonth = new Date(year, month, 0).getDate();
  const todayKey = today.toDateString();
  const days: CalendarGridDay[] = [];

  for (let index = offset - 1; index >= 0; index -= 1) {
    const num = daysInPreviousMonth - index;
    days.push({
      date: new Date(year, month - 1, num),
      isCurrent: false,
      isToday: false,
      num,
    });
  }
  for (let num = 1; num <= daysInMonth; num += 1) {
    const date = new Date(year, month, num);
    days.push({
      date,
      isCurrent: true,
      isToday: date.toDateString() === todayKey,
      num,
    });
  }
  const remaining = 42 - days.length;
  for (let num = 1; num <= remaining; num += 1) {
    days.push({
      date: new Date(year, month + 1, num),
      isCurrent: false,
      isToday: false,
      num,
    });
  }
  return days;
}


export function calendarSourceName(
  source: string,
  configs: readonly CalendarSourceConfig[],
): string {
  const configuredName = configs.find((config) => config.source === source)?.name;
  if (configuredName) return configuredName;
  try {
    const url = new URL(source);
    const filename = url.pathname.split('/').pop() ?? '';
    const pathName = filename.replace(/\.ics$/iu, '');
    return pathName || url.hostname;
  } catch {
    return source;
  }
}


export function groupCalendarSources(
  sources: readonly string[],
  configs: readonly CalendarSourceConfig[],
): CalendarSourceGroup[] {
  const groups = new Map<string, CalendarSourceEntry[]>();
  for (const source of sources) {
    if (source === 'es_es') continue;
    const config = configs.find((candidate) => candidate.source === source);
    const account = config?.account || 'Other';
    const calendars = groups.get(account) ?? [];
    calendars.push({ source, config });
    groups.set(account, calendars);
  }
  return Array.from(groups, ([account, calendars]) => ({ account, calendars }));
}

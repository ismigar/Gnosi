import type { TimelineScale, TimelineTick, TimelineUnit, TimelineZoom } from './types';

const DAY = 86400000;

function boundary(date: Date, month: boolean): Date {
    const next = new Date(date);
    next.setHours(0, 0, 0, 0);
    if (month) next.setDate(1);
    return next;
}

/** Calendar boundaries use local dates so DST never moves a week off Monday. */
export function calendarScale(
    range: TimelineScale | null,
    unit: TimelineUnit,
    zoom: TimelineZoom,
    locale: string,
    fitted: boolean,
    focus?: Date | null,
    pixelWidth = 1000,
): TimelineScale | null {
    if (!range) return null;
    const start = boundary(range.start, unit !== 'hours');
    const end = boundary(range.end, unit !== 'hours');
    if (unit === 'hours') end.setDate(end.getDate() + 1);
    else end.setMonth(end.getMonth() + 1);
    if (focus) {
        if (focus < start) { start.setTime(focus.getTime()); start.setHours(0, 0, 0, 0); }
        if (focus >= end) { end.setTime(focus.getTime()); end.setDate(end.getDate() + 7); }
    }
    const yearView = zoom === 'year' && !fitted;
    if (yearView) { start.setMonth(0, 1); end.setFullYear(end.getFullYear() + 1, 0, 1); }
    const spanDays = Math.max(1, (end.getTime() - start.getTime()) / DAY);
    const displayZoom = fitted ? (spanDays <= 45 ? 'week' : 'month') : zoom;
    const weekly = unit !== 'hours' && (displayZoom === 'week' || (displayZoom === 'month' && (!fitted || pixelWidth / spanDays * 7 >= 28)));
    const months: TimelineTick[] = [];
    const ticks: TimelineTick[] = [];
    const cursor = new Date(start);
    if (unit === 'years') {
        cursor.setMonth(0, 1);
        const years = Math.max(1, end.getFullYear() - cursor.getFullYear());
        const step = Math.max(1, Math.ceil(years / (fitted ? 12 : 40)));
        for (let guard = 0; cursor < end && guard < 1000; guard += 1) {
            const year = cursor.getFullYear();
            ticks.push({ at: new Date(cursor), label: year < 0 ? `${String(-year)} BCE` : String(year) });
            cursor.setFullYear(year + step);
        }
        return { start, end, ticks, months: [] };
    }
    const monthCursor = boundary(start, true);
    for (let guard = 0; monthCursor < end && guard < 1200; guard += 1) {
        months.push({ at: new Date(Math.max(start.getTime(), monthCursor.getTime())), label: new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(monthCursor) });
        monthCursor.setMonth(monthCursor.getMonth() + 1);
    }
    if (unit !== 'hours' && weekly) {
        cursor.setDate(cursor.getDate() - (cursor.getDay() + 6) % 7);
    }
    const monthly = displayZoom === 'year' || (displayZoom === 'month' && !weekly);
    const hourStep = fitted ? Math.max(1, Math.ceil(spanDays * 24 / 12)) : 1;
    for (let guard = 0; cursor < end && guard < 4000; guard += 1) {
        const at = new Date(Math.max(start.getTime(), cursor.getTime()));
        ticks.push({ at, label: new Intl.DateTimeFormat(locale, unit === 'hours' && !yearView
            ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
            : monthly ? { month: 'short' } : { day: 'numeric' }).format(at) });
        if (unit === 'hours' && !yearView) cursor.setHours(cursor.getHours() + hourStep);
        else if (monthly) cursor.setMonth(cursor.getMonth() + 1);
        else cursor.setDate(cursor.getDate() + (weekly ? 7 : 1));
    }
    if (monthly && (unit !== 'hours' || yearView)) {
        months.length = 0;
        const yearCursor = new Date(start);
        yearCursor.setMonth(0, 1);
        for (let guard = 0; yearCursor < end && guard < 1200; guard += 1) {
            months.push({ at: new Date(Math.max(start.getTime(), yearCursor.getTime())), label: String(yearCursor.getFullYear()) });
            yearCursor.setFullYear(yearCursor.getFullYear() + 1);
        }
    }
    return { start, end, ticks, months };
}

export function scaleWidth(scale: TimelineScale | null, unit: TimelineUnit, zoom: TimelineZoom, available: number, fitted: boolean): number {
    if (!scale || fitted) return Math.max(320, available);
    const days = (scale.end.getTime() - scale.start.getTime()) / DAY;
    const width = unit === 'years' ? days / 365 * 100
        : zoom === 'year' ? days / 365 * 600 : unit === 'hours' ? days * 24 * 48 : days * (zoom === 'day' ? 40 : zoom === 'week' ? 18 : 6);
    return Math.max(available, Math.min(200000, width));
}

export function shiftTimelineDate(date: Date, steps: number, unit: TimelineUnit): Date {
    const next = new Date(date);
    if (unit === 'hours') next.setHours(next.getHours() + steps);
    else if (unit === 'years') next.setFullYear(next.getFullYear() + steps);
    else next.setDate(next.getDate() + steps);
    return next;
}

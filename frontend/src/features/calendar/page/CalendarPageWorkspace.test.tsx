import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarEventsQuery } from '../../../shared/api/calendar';
import type { VaultPageSummary } from '../../../shared/api/vaults';
import type { IntegrationsDocument } from '../../../shared/api/integrations';
import { CalendarPageWorkspace } from './CalendarPageWorkspace';
import { useCalendarPage, type CalendarPageController } from './useCalendarPage';
import { externalEvent } from '../components/calendar-sidebar-right/calendarTestFixtures';
import { calendarQueryKeys } from '../../../shared/api/useCalendarData';

const api = vi.hoisted(() => ({
    fetchVaultPages: vi.fn(), fetchVaultTables: vi.fn(), fetchIntegrations: vi.fn(),
    fetchCalendarList: vi.fn(), fetchCalendarEvents: vi.fn(),
    fetchMeetingReminderSettings: vi.fn(), updateMeetingReminderSettings: vi.fn(),
    updateCalendarSelection: vi.fn(), updateCalendarAliases: vi.fn(),
    updateCalendarColors: vi.fn(), updateDefaultCalendar: vi.fn(),
    createVaultPage: vi.fn(), deleteVaultPage: vi.fn(), patchVaultPage: vi.fn(),
    fetchVaultPage: vi.fn(), rsvpCalendarEvent: vi.fn(),
}));
vi.mock('../../../shared/api/vaults', () => api);
vi.mock('../../../shared/api/calendar', () => api);
vi.mock('../../../shared/api/integrations', () => api);
vi.mock('../../../shared/plugins/usePlugins', () => ({ usePlugins: () => ({ isEnabled: () => false }) }));
vi.mock('../../../shared/hooks/useMediaQuery', () => ({ useMediaQuery: () => false }));
vi.mock('../../../shared/editor/useTitlePreview', () => ({
    useTitlePreview: () => ({ openHover: vi.fn(), scheduleClose: vi.fn(), preview: null }),
}));
vi.mock('../../../shared/notifications/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../components/CalendarSidebarLeft', () => ({ CalendarSidebarLeft: () => null }));
vi.mock('../components/CalendarSidebarRight', () => ({ CalendarSidebarRight: () => null }));
vi.mock('react-i18next', () => {
    const t = (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key;
    const i18n = { language: 'en' };
    return { useTranslation: () => ({ t, i18n }) };
});

let controller: CalendarPageController;
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
function Harness() {
    const value = useCalendarPage();
    useLayoutEffect(() => { controller = value; });
    return <CalendarPageWorkspace controller={value} />;
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(finish => { resolve = finish; });
    return { promise, resolve };
}
async function update(action: () => void | Promise<void>) {
    await act(async () => { await action(); await new Promise(resolve => { setTimeout(resolve, 15); }); });
}
async function ready(check: () => void) {
    const deadline = Date.now() + 2000;
    let lastError: unknown;
    do {
        // Finish each act before inspecting state or starting another attempt.
        // Keep this bound below the test deadline so cleanup cannot overlap it.
        await update(() => {});
        try { check(); return; } catch (error) { lastError = error; }
    } while (Date.now() < deadline);
    throw lastError instanceof Error ? lastError : new Error('Calendar state did not settle');
}
async function mount() {
    await update(() => { root.render(<MemoryRouter><QueryClientProvider client={client}><Harness /></QueryClientProvider></MemoryRouter>); });
}
function eventsForRange(query: CalendarEventsQuery): CalendarEvent[] {
    const day = new Date(query.timeMin ?? '2026-09-02').getTime() + 2 * 86_400_000;
    return ['google', 'caldav'].map(provider => ({
        ...externalEvent(provider), start: new Date(day).toISOString().slice(0, 10),
        end: new Date(day + 86_400_000).toISOString().slice(0, 10),
    }));
}
function canvas() { return host.querySelector('.calendar-workspace__canvas'); }
function grid() { return host.querySelector('.fc')?.parentElement?.parentElement?.parentElement; }

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.fetchVaultPages.mockResolvedValue([]);
    api.fetchVaultTables.mockResolvedValue([]);
    api.fetchIntegrations.mockResolvedValue({});
    api.fetchCalendarList.mockResolvedValue({ authError: '', items: [] });
    api.fetchCalendarEvents.mockImplementation((query: CalendarEventsQuery) => Promise.resolve(eventsForRange(query)));
});
afterEach(async () => { await update(() => { root.unmount(); }); client.clear(); host.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('starts external reads from the real calendar range while local data is pending and honors saved hidden calendars', async () => {
    const pages = deferred<VaultPageSummary[]>();
    const settings = deferred<IntegrationsDocument>();
    api.fetchVaultPages.mockReturnValueOnce(pages.promise);
    api.fetchIntegrations.mockReturnValueOnce(settings.promise);
    await mount();
    await ready(() => { expect(api.fetchCalendarEvents).toHaveBeenCalledOnce(); expect(controller.externalEvents).toHaveLength(2); });
    expect(controller.loading).toBe(true);
    expect(api.fetchCalendarEvents).toHaveBeenCalledWith({
        includeVault: false, search: undefined,
        timeMin: controller.dateRange?.start, timeMax: controller.dateRange?.end,
    }, expect.any(AbortSignal));
    expect(controller.dateRange?.start).toBeTruthy();
    expect(controller.selectedCalendars.size).toBe(0);
    expect(host.querySelector('.fc')).not.toBeNull();
    expect(grid()?.getAttribute('aria-hidden')).toBe('true');
    expect(grid()?.hasAttribute('inert')).toBe(true);
    expect(canvas()?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await update(() => {
        pages.resolve([]);
        settings.resolve({ calendars: [{ email: 'google@example.test' }, { email: 'caldav@example.test' }], calendar_selection: ['google@example.test'] });
    });
    await ready(() => {
        expect(controller.loading).toBe(false);
        expect([...controller.selectedCalendars]).toEqual(['google@example.test']);
        expect(host.querySelector('.fc-event-title')?.textContent).toBe('google appointment');
    });
    expect(host.querySelectorAll('.fc-event-title')).toHaveLength(1);
    expect(grid()?.getAttribute('aria-hidden')).toBeNull();
    expect(grid()?.hasAttribute('inert')).toBe(false);
    expect(canvas()?.getAttribute('aria-busy')).toBe('false');
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(api.updateCalendarSelection).not.toHaveBeenCalled();
}, 15_000);

it('keeps a loading indicator until external events arrive even when local data is already ready', async () => {
    const events = deferred<CalendarEvent[]>();
    api.fetchCalendarEvents.mockReturnValueOnce(events.promise);
    await mount();
    await ready(() => { expect(controller.loading).toBe(false); expect(api.fetchCalendarEvents).toHaveBeenCalledOnce(); });
    expect(canvas()?.getAttribute('aria-busy')).toBe('true');
    expect(grid()?.getAttribute('aria-hidden')).toBeNull();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await update(() => { events.resolve(eventsForRange({ timeMin: controller.dateRange?.start, timeMax: controller.dateRange?.end })); });
    await ready(() => { expect(host.querySelectorAll('.fc-event-title')).toHaveLength(2); });
    expect(canvas()?.getAttribute('aria-busy')).toBe('false');
    expect(host.querySelector('[role="status"]')).toBeNull();
}, 15_000);

it('preserves the calendar instance, selected period and view while refreshing local notes', async () => {
    await mount();
    await ready(() => { expect(controller.loading).toBe(false); expect(controller.externalEvents).toHaveLength(2); });
    const calendar = controller.calendarRef.current;
    await update(() => {
        calendar?.getApi().gotoDate('2030-04-15');
        controller.handleViewChange('timeGridWeek');
    });
    const date = calendar?.getApi().getDate().getTime();
    const range = controller.dateRange;
    const pages = deferred<VaultPageSummary[]>();
    api.fetchVaultPages.mockReturnValueOnce(pages.promise);
    let refresh = Promise.resolve();
    await update(() => { refresh = controller.fetchPages(); });
    expect(controller.loading).toBe(false);
    expect(controller.refreshing).toBe(true);
    expect(grid()?.getAttribute('aria-hidden')).toBeNull();
    expect(grid()?.hasAttribute('inert')).toBe(false);
    expect(canvas()?.getAttribute('aria-busy')).toBe('true');
    expect(controller.calendarRef.current).toBe(calendar);
    await update(async () => { pages.resolve([]); await refresh; });
    expect(controller.calendarRef.current).toBe(calendar);
    expect(calendar?.getApi().view.type).toBe('timeGridWeek');
    expect(calendar?.getApi().getDate().getTime()).toBe(date);
    expect(controller.dateRange).toEqual(range);
}, 15_000);

it('reopens the real calendar with completed same-range events while every source revalidates', async () => {
    await mount();
    await ready(() => {
        expect(controller.loading).toBe(false);
        expect(host.querySelectorAll('.fc-event-title')).toHaveLength(2);
    });
    const range = controller.dateRange;
    if (!range) throw new Error('The real calendar did not report its visible range');
    const eventsKey = calendarQueryKeys.events({
        includeVault: false, search: undefined, timeMin: range.start, timeMax: range.end,
    });
    const previousEvents = client.getQueryData<CalendarEvent[]>(eventsKey);
    expect(previousEvents).toHaveLength(2);
    await update(() => { root.render(null); });
    // Expire freshness, not retention: reopening must show these completed
    // results while proving that a real second HTTP read is still pending.
    client.setQueryData(eventsKey, previousEvents, { updatedAt: Date.now() - 60_000 });
    const calendarsKey = calendarQueryKeys.calendars();
    client.setQueryData(calendarsKey, client.getQueryData(calendarsKey), { updatedAt: Date.now() - 60_000 });
    const pages = deferred<VaultPageSummary[]>();
    const settings = deferred<IntegrationsDocument>();
    const events = deferred<CalendarEvent[]>();
    const calendars = deferred<{ authError: string; items: [] }>();
    api.fetchVaultPages.mockReturnValueOnce(pages.promise);
    api.fetchIntegrations.mockReturnValueOnce(settings.promise);
    api.fetchCalendarEvents.mockReturnValueOnce(events.promise);
    api.fetchCalendarList.mockReturnValueOnce(calendars.promise);
    await mount();
    await ready(() => {
        expect(controller.dateRange).toEqual(range);
        expect(api.fetchCalendarEvents).toHaveBeenCalledTimes(2);
        expect(api.fetchCalendarList).toHaveBeenCalledTimes(2);
        expect(api.fetchVaultPages).toHaveBeenCalledTimes(2);
        expect(api.fetchIntegrations).toHaveBeenCalledTimes(2);
        expect(host.querySelectorAll('.fc-event-title')).toHaveLength(2);
    });
    expect(controller.loading).toBe(false);
    expect(controller.refreshing).toBe(true);
    expect(controller.externalEventsLoading).toBe(false);
    expect(controller.externalEventsRefreshing).toBe(true);
    expect(grid()?.getAttribute('aria-hidden')).toBeNull();
    expect(grid()?.hasAttribute('inert')).toBe(false);
    expect(canvas()?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    await update(() => {
        pages.resolve([]); settings.resolve({}); calendars.resolve({ authError: '', items: [] });
        events.resolve(eventsForRange({ timeMin: range.start, timeMax: range.end }).slice(0, 1));
    });
    await ready(() => {
        expect(host.querySelectorAll('.fc-event-title')).toHaveLength(1);
        expect(canvas()?.getAttribute('aria-busy')).toBe('false');
    });
    expect(api.updateCalendarSelection).not.toHaveBeenCalled();
}, 15_000);

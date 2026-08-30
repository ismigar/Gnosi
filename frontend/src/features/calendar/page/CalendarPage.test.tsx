import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCalendarPage, type CalendarPageController } from './useCalendarPage';
import { createVaultPage, deleteVaultPage, fetchVaultPage, fetchVaultPages, fetchVaultTables, patchVaultPage } from '../../../shared/api/vaults';
import { fetchCalendarList, fetchCalendarEvents, fetchMeetingReminderSettings, updateMeetingReminderSettings, rsvpCalendarEvent } from '../../../shared/api/calendar';
import { fetchIntegrations, updateCalendarAliases, updateCalendarColors, updateCalendarSelection, updateDefaultCalendar } from '../../../shared/api/integrations';
import { calendarQueryKeys } from '../../../shared/api/useCalendarData';
import { externalEvent, LOCAL_EVENT, mutation, pageSummary } from '../../../components/Vault/calendar-sidebar-right/calendarTestFixtures';
import { toast } from '../../../lib/toast';

vi.mock('react-i18next', () => { const t = (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key; return {useTranslation: () => ({t})}; });
vi.mock('../../../lib/toast', () => ({toast: {error: vi.fn(), success: vi.fn()}}));
vi.mock('../../../plugins/usePlugins', () => ({usePlugins: () => ({isEnabled: () => true})}));
vi.mock('../../../hooks/useMediaQuery', () => ({useMediaQuery: () => false}));
vi.mock('../../../shared/api/vaults', () => ({createVaultPage: vi.fn(), deleteVaultPage: vi.fn(), fetchVaultPage: vi.fn(), fetchVaultPages: vi.fn(), fetchVaultTables: vi.fn(), patchVaultPage: vi.fn()}));
vi.mock('../../../shared/api/integrations', () => ({fetchIntegrations: vi.fn(), updateCalendarAliases: vi.fn(), updateCalendarColors: vi.fn(), updateCalendarSelection: vi.fn(), updateDefaultCalendar: vi.fn()}));
vi.mock('../../../shared/api/calendar', () => ({fetchCalendarList: vi.fn(), fetchCalendarEvents: vi.fn(), fetchMeetingReminderSettings: vi.fn(), updateMeetingReminderSettings: vi.fn(), rsvpCalendarEvent: vi.fn()}));
let root: Root;
let container: HTMLDivElement;
let current: CalendarPageController | null = null;
let client: QueryClient;
function Harness() {
    const controller = useCalendarPage();
    useEffect(() => { current = controller; });
    return <output>{controller.loading ? 'loading' : controller.pages.map(page => page.title).join(',')}</output>;
}
function page(): CalendarPageController { if (!current) throw new Error('Calendar not mounted'); return current; }
async function run(action: () => void | Promise<void>) {
    await act(async () => { await action(); await new Promise(resolve => { setTimeout(resolve, 15); }); });
}
beforeAll(() => { (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
    current = null; container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    client = new QueryClient({defaultOptions: {queries: {retry: false}, mutations: {retry: false}}});
    vi.mocked(fetchVaultPages).mockResolvedValue([pageSummary()]);
    vi.mocked(fetchVaultPage).mockResolvedValue({...mutation(), etag: 'test-etag'});
    vi.mocked(updateCalendarSelection).mockResolvedValue({status: 'success'});
    vi.mocked(fetchVaultTables).mockResolvedValue([{id: 'table-calendar', name: 'Appointments'}]);
    vi.mocked(fetchIntegrations).mockResolvedValue({vault_calendar: {enabled_tables: ['table-calendar']}, calendars: [{email: 'google@example.test'}, {email: 'caldav@example.test'}], calendar_selection: ['Appointments']});
    vi.mocked(fetchCalendarList).mockResolvedValue({authError: '', items: [{id: 'primary', name: 'CalDAV', account: 'caldav@example.test', provider: 'caldav', primary: true}]});
    vi.mocked(fetchCalendarEvents).mockResolvedValue([externalEvent('google'), externalEvent('caldav')]);
    vi.mocked(fetchMeetingReminderSettings).mockResolvedValue({enabled: true, lead_minutes: 15});
    vi.mocked(updateMeetingReminderSettings).mockResolvedValue({enabled: false, lead_minutes: 15});
    vi.mocked(createVaultPage).mockResolvedValue(mutation({id: 'split'}));
    vi.mocked(patchVaultPage).mockResolvedValue(mutation());
});
afterEach(async () => { await run(() => { root.unmount(); }); client.clear(); container.remove(); vi.clearAllMocks(); });
async function mount() {
    await run(() => { root.render(<MemoryRouter><QueryClientProvider client={client}><Harness /></QueryClientProvider></MemoryRouter>); });
    await run(() => {});
}

describe('calendar page controller', () => {
    it('loads local pages, restores selection, and retains explicit hiding when async calendars arrive', async () => {
        await mount();
        expect(container.textContent).toContain('Local appointment');
        expect([...page().selectedCalendars]).toEqual(['Appointments']);
        await run(() => { page().toggleCalendar('Appointments'); });
        expect(updateCalendarSelection).toHaveBeenCalledWith({selection: []});
        await run(() => { client.setQueryData(calendarQueryKeys.calendars(), {items: [{id: 'late', account: 'caldav@example.test', name: 'Later', provider: 'caldav'}], authError: ''}); });
        expect(page().selectedCalendars.size).toBe(0);
        await run(() => { page().toggleCalendar('caldav@example.test'); });
        expect(updateCalendarSelection).toHaveBeenLastCalledWith({selection: ['caldav@example.test']});
    });
    it('persists aliases, colors, default calendar and reminder settings', async () => {
        await mount();
        await run(async () => { await page().renameCalendar('Appointments', ' Visits '); });
        expect(updateCalendarAliases).toHaveBeenCalledWith({Appointments: 'Visits'});
        await run(async () => { await page().updateColor('Appointments', '#123456'); });
        expect(updateCalendarColors).toHaveBeenCalledWith({Appointments: '#123456'});
        await run(async () => { await page().setDefaultCalendar('caldav@example.test'); });
        expect(updateDefaultCalendar).toHaveBeenCalledWith('caldav@example.test');
        expect(page().defaultCalendarId).toBe('caldav@example.test');
        expect(page().remindersLead).toBe(15);
        await run(async () => { await page().saveReminderSettings({enabled: false}); });
        expect(vi.mocked(updateMeetingReminderSettings).mock.calls[0]?.[0]).toEqual({enabled: false, lead_minutes: 15});
    });
    it('fetches external events by visible range/search and opens Google and CalDAV editing contexts', async () => {
        await mount(); await run(() => { page().setDateRange({start: '2026-09-01', end: '2026-10-01'}); });
        expect(fetchCalendarEvents).toHaveBeenCalledWith({timeMin: '2026-09-01', timeMax: '2026-10-01', search: undefined, includeVault: false}, expect.any(AbortSignal));
        for (const provider of ['google','caldav']) {
            await run(async () => { await page().handleEventClick(provider + '-event'); });
            expect(page().eventPanel).toMatchObject({mode: 'edit', isExternal: true, data: {metadata: {_provider: provider}}});
        }
        await run(() => { page().setSearchQuery('meeting'); });
        expect(fetchCalendarEvents).toHaveBeenLastCalledWith(expect.objectContaining<Record<string, unknown>>({search: 'meeting'}), expect.any(AbortSignal));
        await run(async () => { await page().handleEventClick('local-event'); });
        expect(fetchVaultPage).toHaveBeenCalledWith('local-event');
        expect(page().eventPanel?.mode).toBe('edit');
    });
    it('updates selected external attendees optimistically on RSVP', async () => {
        vi.mocked(fetchCalendarEvents).mockResolvedValue([{...externalEvent('caldav'), attendees: [{email: 'caldav@example.test', name: 'Me', self: true, organizer: false, rsvp: 'tentative'}]}]);
        await mount(); await run(() => { page().setDateRange({start: '2026-09-01', end: '2026-10-01'}); });
        await run(async () => { await page().handleEventClick('caldav-event'); await page().handleRsvp('accepted'); });
        // The click and RSVP use the current committed panel, as UI events do.
        await run(async () => { await page().handleRsvp('accepted'); });
        expect(rsvpCalendarEvent).toHaveBeenCalledWith({calendarId: 'primary', email: 'caldav@example.test', eventId: 'caldav-event', rsvp: 'accepted'});
        expect(page().externalEvents[0]?.metadata.attendees?.[0]?.rsvp).toBe('accepted');
    });
    it('opens timed drafts without creating pages and toggles local event selection', async () => {
        await mount();
        await run(() => { page().handleCreateEventAtDate(new Date('2026-09-02T09:30:00')); });
        expect(page().eventPanel).toMatchObject({mode: 'create', date: '2026-09-02T09:30:00', data: null});
        expect(createVaultPage).not.toHaveBeenCalled();
        await run(async () => { await page().handleEventClick('local-event'); });
        await run(async () => { await page().handleEventClick('local-event'); });
        expect(page().eventPanel).toBeNull();
    });
    it('preserves the existing two-flag drag recurrence semantics and context clearing', async () => {
        vi.mocked(fetchVaultPages).mockResolvedValue([{...pageSummary(), metadata: {...LOCAL_EVENT.metadata, rrule: 'FREQ=DAILY'}}]);
        await mount();
        await run(async () => { await page().handleEventClick('local-event', {date: '2026-09-05', instanceStart: '2026-09-02'}, 'move'); });
        expect(page().isRecurrenceModifyOpen).toBe(true);
        await run(async () => { await page().executeModify(true, false); });
        expect(patchVaultPage).toHaveBeenCalledWith('local-event', expect.objectContaining<Record<string, unknown>>({metadata: expect.objectContaining<Record<string, unknown>>({exdates: ['2026-09-02']})}));
        expect(createVaultPage).toHaveBeenCalled();
        await run(() => { page().handleContextMenu({x: 20, y: 30, date: '2026-09-02', eventId: 'local-event', instanceStart: '2026-09-02', allDay: true}); });
        await run(() => { page().handleDeleteFromContext(); });
        expect(page().contextMenu).toMatchObject({open: false, instanceStart: '', allDay: false});
        expect(deleteVaultPage).not.toHaveBeenCalled();
    });
    it('reports partial loading and settings failures while leaving local pages usable', async () => {
        vi.mocked(fetchIntegrations).mockRejectedValueOnce(new Error('offline'));
        vi.mocked(updateCalendarColors).mockRejectedValueOnce(new Error('offline'));
        await mount(); expect(page().pages).toHaveLength(1);
        expect(toast.error).toHaveBeenCalled();
        await run(async () => { await page().updateColor('Appointments', '#000000'); });
        expect(toast.error).toHaveBeenCalledWith('calendar.calendar_color_update_error');
    });
});

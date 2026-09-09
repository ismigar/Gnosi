import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarQueryKeys } from '../../../shared/api/useCalendarData';
import type { CalendarEvent, CalendarListResult } from '../../../shared/api/calendar';
import type { VaultPageSummary } from '../../../shared/api/vaults';
import type { IntegrationsDocument } from '../../../shared/api/integrations';
import { externalEvent, pageSummary } from '../components/calendar-sidebar-right/calendarTestFixtures';
import { useCalendarSources } from './useCalendarSources';

const scope = vi.hoisted(() => ({ vaultId: 'vault-a' }));
const api = vi.hoisted(() => ({
    fetchVaultPages: vi.fn(), fetchVaultTables: vi.fn(), fetchIntegrations: vi.fn(),
    fetchCalendarList: vi.fn(), fetchCalendarEvents: vi.fn(), updateCalendarSelection: vi.fn(),
    updateCalendarAliases: vi.fn(), updateCalendarColors: vi.fn(), updateDefaultCalendar: vi.fn(),
}));
const notices = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('../../../shared/api/vaults', () => api);
vi.mock('../../../shared/api/calendar', () => api);
vi.mock('../../../shared/api/integrations', () => api);
vi.mock('../../../shared/api/vault-context', () => ({ getActiveVaultId: () => scope.vaultId }));
vi.mock('../../../shared/notifications/toast', () => ({ toast: notices }));
vi.mock('react-i18next', () => {
    const t = (key: string) => key;
    return { useTranslation: () => ({ t }) };
});

const range = { start: '2026-09-01', end: '2026-10-01' };
let current: ReturnType<typeof useCalendarSources>;
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
function Harness() {
    const value = useCalendarSources('', range);
    useLayoutEffect(() => { current = value; });
    return <output>{[...value.pages, ...value.externalEvents].map(event => event.title).join(',')}</output>;
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
    await update(() => { root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>); });
}
const settings: IntegrationsDocument = {
    vault_calendar: { enabled_tables: ['table-calendar'] },
    calendars: [{ email: 'google@example.test' }],
    calendar_selection: ['Appointments', 'google@example.test'],
};

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    scope.vaultId = 'vault-a';
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    api.fetchVaultPages.mockResolvedValue([pageSummary()]);
    api.fetchVaultTables.mockResolvedValue([{ id: 'table-calendar', name: 'Appointments' }]);
    api.fetchIntegrations.mockResolvedValue(settings);
    api.fetchCalendarList.mockResolvedValue({ authError: '', items: [] });
    api.fetchCalendarEvents.mockResolvedValue([externalEvent('google')]);
    api.updateCalendarSelection.mockResolvedValue({ status: 'success' });
});
afterEach(async () => {
    await update(() => { root.unmount(); });
    client.clear(); host.remove(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

describe('calendar source continuity', () => {
    it('keeps a complete snapshot through partial and failed refreshes, including reopening', async () => {
        await mount();
        await ready(() => { expect(current.loading).toBe(false); expect(current.pages).toHaveLength(1); });
        const key = calendarQueryKeys.localSources();
        const complete = client.getQueryData(key);
        api.fetchVaultPages.mockResolvedValueOnce([{ ...pageSummary(), title: 'Incomplete replacement' }]);
        api.fetchIntegrations.mockRejectedValueOnce(new Error('settings unavailable'));
        await update(async () => { await current.fetchPages(); });
        expect(current.pages[0]?.title).toBe('Local appointment');
        expect(current.localSourcesError).toBe(true);
        expect(client.getQueryData(key)).toBe(complete);
        expect(notices.error).toHaveBeenCalledWith('calendar.partial_data_warning');

        api.fetchVaultPages.mockRejectedValueOnce(new Error('pages unavailable'));
        await update(async () => { await current.fetchPages(); });
        expect(current.pages[0]?.title).toBe('Local appointment');
        expect(client.getQueryData(key)).toBe(complete);
        expect(notices.error).toHaveBeenCalledWith('calendar.error_loading_pages');

        await update(() => { root.render(null); });
        const pending = deferred<VaultPageSummary[]>();
        api.fetchVaultPages.mockReturnValueOnce(pending.promise);
        await mount();
        expect(current.loading).toBe(false);
        expect(current.refreshing).toBe(true);
        expect(current.pages[0]?.title).toBe('Local appointment');
        await update(() => { pending.resolve([{ ...pageSummary(), title: 'Complete replacement' }]); });
        await ready(() => { expect(current.pages[0]?.title).toBe('Complete replacement'); });
        expect(current.localSourcesError).toBe(false);
    });

    it('shows useful pages on a first partial read without caching it as complete', async () => {
        api.fetchIntegrations.mockRejectedValueOnce(new Error('settings unavailable'));
        await mount();
        await ready(() => { expect(current.localSourcesError).toBe(true); });
        expect(current.loading).toBe(false);
        expect(current.pages[0]?.title).toBe('Local appointment');
        expect(client.getQueryData(calendarQueryKeys.localSources())).toBeUndefined();
        expect(notices.error).toHaveBeenCalledWith('calendar.partial_data_warning');
        await update(async () => { await current.fetchPages(); });
        expect(current.localSourcesError).toBe(false);
        expect(client.getQueryData(calendarQueryKeys.localSources())).toBeDefined();
    });

    it('isolates identical IDs and ranges across vaults, including late reads and mutation callbacks', async () => {
        await mount();
        await ready(() => { expect(current.pages).toHaveLength(1); expect(current.externalEvents).toHaveLength(1); });
        const editOldPages = current.setPages;
        const oldPages = deferred<VaultPageSummary[]>();
        api.fetchVaultPages.mockReturnValueOnce(oldPages.promise);
        let previousRead = Promise.resolve();
        await update(() => { previousRead = current.fetchPages(); });

        const newPages = deferred<VaultPageSummary[]>();
        const newSettings = deferred<IntegrationsDocument>();
        const newEvents = deferred<CalendarEvent[]>();
        const newCalendars = deferred<CalendarListResult>();
        api.fetchVaultPages.mockReturnValueOnce(newPages.promise);
        api.fetchIntegrations.mockReturnValueOnce(newSettings.promise);
        api.fetchCalendarEvents.mockReturnValueOnce(newEvents.promise);
        api.fetchCalendarList.mockReturnValueOnce(newCalendars.promise);
        scope.vaultId = 'vault-b';
        await mount();
        expect(current.pages).toEqual([]);
        expect(current.externalEvents).toEqual([]);
        expect(current.calendarConfigs).toEqual([]);
        expect(current.selectedCalendars.size).toBe(0);
        expect(current.loading).toBe(true);
        expect(host.textContent).not.toContain('Local appointment');
        await update(async () => {
            oldPages.resolve([{ ...pageSummary(), title: 'Late Alpha' }]);
            await previousRead;
            editOldPages(previous => previous.map(page => ({ ...page, title: 'Edited Alpha' })));
        });
        expect(current.pages).toEqual([]);
        expect(current.externalEvents).toEqual([]);
        await update(() => {
            newPages.resolve([{ ...pageSummary(), title: 'Beta local' }]);
            newSettings.resolve({ ...settings, calendar_selection: ['Appointments'] });
            newEvents.resolve([{ ...externalEvent('google'), title: 'Beta external' }]);
            newCalendars.resolve({ authError: '', items: [] });
        });
        await ready(() => { expect(current.pages[0]?.title).toBe('Beta local'); expect(current.externalEvents[0]?.title).toBe('Beta external'); });
        expect([...current.selectedCalendars]).toEqual(['Appointments']);
        expect(host.textContent).not.toContain('Alpha');
        expect(api.updateCalendarSelection).not.toHaveBeenCalled();
    });

    it('retains local edits in the vault snapshot used on reopening', async () => {
        await mount();
        await ready(() => { expect(current.pages).toHaveLength(1); });
        await update(() => { current.setPages(previous => previous.map(page => ({ ...page, title: 'Saved edit' }))); });
        await update(() => { root.render(null); });
        const pending = deferred<VaultPageSummary[]>();
        api.fetchVaultPages.mockReturnValueOnce(pending.promise);
        await mount();
        expect(current.pages[0]?.title).toBe('Saved edit');
        expect(current.loading).toBe(false);
        await update(() => { pending.resolve([{ ...pageSummary(), title: 'Saved edit' }]); });
    });

    it('reconciles refreshed visibility settings while preserving a selection made in the open calendar', async () => {
        await mount();
        await ready(() => { expect(current.selectedCalendars).toContain('google@example.test'); });
        api.fetchIntegrations.mockResolvedValueOnce({ ...settings, calendar_selection: ['Appointments'] });
        await update(async () => { await current.fetchPages(); });
        await ready(() => { expect([...current.selectedCalendars]).toEqual(['Appointments']); });
        await update(() => { current.toggleCalendar('Appointments'); });
        expect(current.selectedCalendars.size).toBe(0);
        await update(async () => { await current.fetchPages(); });
        expect(current.selectedCalendars.size).toBe(0);
        expect(api.updateCalendarSelection).toHaveBeenCalledTimes(1);
    });
});

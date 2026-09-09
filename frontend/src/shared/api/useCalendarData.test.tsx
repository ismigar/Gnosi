import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
    calendarQueryKeys, useCalendarEvents, useCalendarList, useMeetingReminders,
    useMeetingReminderSettings, useUpdateMeetingReminderSettings, useDismissMeetingReminder,
} from './useCalendarData';
import type { CalendarEvent, CalendarEventsQuery, CalendarStatus, MeetingReminderSettings } from './calendar';

function externalEvent(provider: string): CalendarEvent {
    return {
        id: `${provider}-event`, title: `${provider} appointment`, provider,
        account: `${provider}@example.test`, calendar_id: 'primary', calendar_name: provider,
        start: '2026-09-02', end: '2026-09-04', all_day: true,
        source: `${provider}@example.test`, location: '', description: '',
        status: 'confirmed', link: '', is_read_only: false,
    };
}

const scope = vi.hoisted(() => ({ vaultId: 'vault-a' }));
const api = vi.hoisted(() => ({
    fetchCalendarEvents: vi.fn(), fetchCalendarList: vi.fn(), fetchMeetingReminders: vi.fn(),
    fetchMeetingReminderSettings: vi.fn(), updateMeetingReminderSettings: vi.fn(), dismissMeetingReminder: vi.fn(),
}));
vi.mock('./calendar', () => api);
vi.mock('./vault-context', () => ({ getActiveVaultId: () => scope.vaultId }));

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
let current: ReturnType<typeof useData>;
let query: CalendarEventsQuery;
function useData() {
    return {
        events: useCalendarEvents(query), calendars: useCalendarList(), reminders: useMeetingReminders(),
        settings: useMeetingReminderSettings(), update: useUpdateMeetingReminderSettings(),
        dismiss: useDismissMeetingReminder(),
    };
}
function Harness() {
    const value = useData();
    useLayoutEffect(() => { current = value; });
    return null;
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
beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    scope.vaultId = 'vault-a'; query = { timeMin: '2026-09-01', timeMax: '2026-10-01', includeVault: false };
    host = document.createElement('div'); root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    api.fetchCalendarEvents.mockResolvedValue([externalEvent('google')]);
    api.fetchCalendarList.mockResolvedValue({ items: [], authError: '' });
    api.fetchMeetingReminders.mockResolvedValue({ reminders: [] });
    api.fetchMeetingReminderSettings.mockResolvedValue({ enabled: true, lead_minutes: 15 });
});
afterEach(async () => {
    await update(() => { root.unmount(); }); client.clear(); host.remove(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

it('keeps previous-range placeholders only inside the same vault', async () => {
    await mount();
    await ready(() => { expect(current.events.data).toHaveLength(1); });
    const nextRange = deferred<CalendarEvent[]>();
    api.fetchCalendarEvents.mockReturnValueOnce(nextRange.promise);
    query = { ...query, timeMin: '2026-10-01', timeMax: '2026-11-01' };
    await mount();
    expect(current.events.isPlaceholderData).toBe(true);
    expect(current.events.data).toHaveLength(1);
    const otherVault = deferred<CalendarEvent[]>();
    api.fetchCalendarEvents.mockReturnValueOnce(otherVault.promise);
    scope.vaultId = 'vault-b';
    await mount();
    expect(current.events.isPlaceholderData).toBe(false);
    expect(current.events.data).toBeUndefined();
    await update(() => { nextRange.resolve([{ ...externalEvent('google'), title: 'Late Alpha' }]); });
    expect(current.events.data).toBeUndefined();
    await update(() => { otherVault.resolve([{ ...externalEvent('google'), title: 'Beta' }]); });
    await ready(() => { expect(current.events.data?.[0]?.title).toBe('Beta'); });
});

it('retains a completed empty range during revalidation instead of treating it as a first load', async () => {
    api.fetchCalendarEvents.mockResolvedValueOnce([]);
    await mount();
    await ready(() => { expect(current.events.data).toEqual([]); });
    await update(() => { root.render(null); });
    const key = calendarQueryKeys.events(query);
    client.setQueryData(key, [], { updatedAt: Date.now() - 60_000 });
    const pending = deferred<CalendarEvent[]>();
    api.fetchCalendarEvents.mockReturnValueOnce(pending.promise);
    await mount();
    expect(current.events.data).toEqual([]);
    expect(current.events.isPending).toBe(false);
    expect(current.events.isRefetching).toBe(true);
    await update(() => { pending.resolve([externalEvent('google')]); });
});

it('applies a late settings mutation and reminder invalidation to its original vault', async () => {
    await mount();
    await ready(() => { expect(current.settings.data?.lead_minutes).toBe(15); });
    const pending = deferred<MeetingReminderSettings>();
    api.updateMeetingReminderSettings.mockReturnValueOnce(pending.promise);
    let mutation = Promise.resolve<MeetingReminderSettings>({ enabled: false, lead_minutes: 25 });
    await update(() => { mutation = current.update.mutateAsync({ enabled: false, lead_minutes: 25 }); });
    scope.vaultId = 'vault-b';
    api.fetchMeetingReminderSettings.mockResolvedValueOnce({ enabled: true, lead_minutes: 5 });
    await mount();
    await ready(() => { expect(current.settings.data?.lead_minutes).toBe(5); });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await update(async () => { pending.resolve({ enabled: false, lead_minutes: 25 }); await mutation; });
    expect(client.getQueryData(calendarQueryKeys.reminderSettings('vault-a'))).toEqual({ enabled: false, lead_minutes: 25 });
    expect(current.settings.data).toEqual({ enabled: true, lead_minutes: 5 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: calendarQueryKeys.reminders('vault-a') });
    expect(client.getQueryState(calendarQueryKeys.reminders('vault-b'))?.isInvalidated).toBe(false);
});

it('keeps dismissal invalidations scoped while preserving the global calendar prefix', async () => {
    await mount();
    await ready(() => { expect(current.events.data).toHaveLength(1); });
    const pending = deferred<CalendarStatus>();
    api.dismissMeetingReminder.mockReturnValueOnce(pending.promise);
    let mutation: Promise<CalendarStatus> | undefined;
    await update(() => { mutation = current.dismiss.mutateAsync('reminder'); });
    scope.vaultId = 'vault-b';
    await mount();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await update(async () => { pending.resolve({ status: 'success' }); await mutation; });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: calendarQueryKeys.reminders('vault-a') });
    expect(client.getQueryState(calendarQueryKeys.reminders('vault-b'))?.isInvalidated).toBe(false);
    await update(async () => { await client.invalidateQueries({ queryKey: calendarQueryKeys.all, refetchType: 'none' }); });
    expect(client.getQueryState(calendarQueryKeys.events(query, 'vault-a'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(calendarQueryKeys.events(query, 'vault-b'))?.isInvalidated).toBe(true);
});

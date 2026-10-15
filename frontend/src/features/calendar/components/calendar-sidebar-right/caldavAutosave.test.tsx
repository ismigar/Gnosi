import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { EventForm } from './EventForm';
import { CALENDARS, LOCAL_EVENT } from './calendarTestFixtures';
import { createCalendarEvent, updateCalendarEvent } from '../../../../shared/api/calendar';
import { patchVaultPage } from '../../../../shared/api/vaults';
import { mutation } from './calendarTestFixtures';
import { calendarConfigsFor } from '../../page/calendarPageModel';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
    t: (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key,
}) }));
vi.mock('../../../../shared/notifications/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../../shared/api/vaults', () => ({ createVaultPage: vi.fn(), patchVaultPage: vi.fn(), deleteVaultPage: vi.fn() }));
vi.mock('../../../../shared/api/calendar', () => ({
    createCalendarEvent: vi.fn(), updateCalendarEvent: vi.fn(), deleteCalendarEvent: vi.fn(),
    geocodeCalendarLocation: vi.fn(), searchCalendarAttendees: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;
beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
    await act(async () => { root.unmount(); await Promise.resolve(); });
    container.remove(); vi.clearAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs();
});
async function title(value: string) {
    const input = container.querySelector('input[required][type=text]');
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing event title');
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
}

it.each([
    ['caldav', '/home/work-b/'],
    ['google', '/home/work-a/'],
])('creates in the selected %s destination despite duplicate names or provider IDs', async (provider, calendarId) => {
    const account = 'owner@example.test';
    const calendars = calendarConfigsFor([account, `${account} - Work`], {}, [], [
        { id: '/home/work-a/', account, name: 'Work', provider: 'caldav' },
        { id: calendarId, account, name: 'Work', provider },
    ]);
    vi.mocked(createCalendarEvent).mockResolvedValue({ id: 'selected-calendar-event', etag: '"one"' });
    await act(async () => { root.render(<EventForm mode="create" eventData={null} initialDate="2026-10-14" calendars={calendars} />); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    const select = container.querySelector('select[aria-label="Calendar"]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('Missing destination selector');
    const destination = calendars.find(calendar => calendar.provider === provider && calendar.google_calendar_id === calendarId);
    if (!destination) throw new Error('Missing discovered destination');
    expect(select.options).toHaveLength(2);
    expect(new Set([...select.options].map(option => option.value)).size).toBe(2);
    expect(new Set([...select.options].map(option => option.text)).size).toBe(2);
    await act(async () => { select.value = destination.id; select.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
    await title('Selected destination');
    expect(createCalendarEvent).toHaveBeenCalledOnce();
    expect(createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({
        email: account, calendarId, event: expect.objectContaining<Record<string, unknown>>({ provider }),
    }));
});

it('shows the original provider destination when editing a same-named calendar event', async () => {
    const account = 'owner@example.test';
    const calendars = calendarConfigsFor([], {}, [], ['/home/work-a/', '/home/work-b/'].map(id => ({
        id, account, name: 'Work', provider: 'caldav',
    })));
    const event = { ...LOCAL_EVENT, metadata: { ...LOCAL_EVENT.metadata,
        _provider: 'caldav', _account: account, _calendar_id: '/home/work-b/', _etag: '"one"',
    } };
    await act(async () => { root.render(<EventForm mode="edit" eventData={event} initialDate="" calendars={calendars} />); await Promise.resolve(); });
    const select = container.querySelector('select[aria-label="Calendar"]');
    if (!(select instanceof HTMLSelectElement)) throw new Error('Missing destination selector');
    expect(select.value).toBe(calendars.find(calendar => calendar.google_calendar_id === '/home/work-b/')?.id);
});

it('carries each returned CalDAV version into the next autosave', async () => {
    const resource = 'https://calendar.example.test/work/event.ics';
    vi.mocked(createCalendarEvent).mockResolvedValue({ id: 'created', etag: '"one"', resource_url: resource });
    vi.mocked(updateCalendarEvent).mockResolvedValueOnce({ status: 'success', etag: '"two"', resource_url: resource })
        .mockResolvedValueOnce({ status: 'success', etag: '"three"', resource_url: resource });
    await act(async () => { root.render(<EventForm mode="create" eventData={null} initialDate="2026-10-14" calendars={CALENDARS} defaultCalendarId="caldav" />); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    await title('Created');
    await title('Changed once');
    await title('Changed twice');
    expect(createCalendarEvent).toHaveBeenCalledOnce();
    expect(updateCalendarEvent).toHaveBeenNthCalledWith(1, expect.objectContaining<Record<string, unknown>>({
        event: expect.objectContaining<Record<string, unknown>>({ etag: '"one"', resource_url: resource }),
    }));
    expect(updateCalendarEvent).toHaveBeenNthCalledWith(2, expect.objectContaining<Record<string, unknown>>({
        event: expect.objectContaining<Record<string, unknown>>({ etag: '"two"', resource_url: resource }),
    }));
});

it('preserves external text including whitespace when only the title changes', async () => {
    vi.mocked(updateCalendarEvent).mockResolvedValue({ status: 'success', etag: '"two"' });
    const description = '  Provider description\n  ';
    const location = '  Meeting room  ';
    const onSaved = vi.fn();
    const event = { ...LOCAL_EVENT, content: '', metadata: {
        ...LOCAL_EVENT.metadata, description, location, _provider: 'caldav',
        _account: 'caldav@example.test', _calendar_id: '/work/', _etag: '"one"',
        _resource_url: 'https://calendar.example.test/work/event.ics',
    } };
    await act(async () => { root.render(<EventForm mode="edit" eventData={event} initialDate="" calendars={CALENDARS} onSaved={onSaved} />); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    await title('New title');
    expect(updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({
        event: expect.objectContaining<Record<string, unknown>>({ description, location, etag: '"one"' }),
    }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({
        content: description, metadata: expect.objectContaining<Record<string, unknown>>({ description, location }),
    }));
});

it.each(['google', 'caldav'])('shows local time and preserves the instant on a %s title edit', async (provider) => {
    vi.stubEnv('TZ', 'Europe/Madrid');
    vi.mocked(updateCalendarEvent).mockResolvedValue({ status: 'success', etag: '"two"' });
    const event = { ...LOCAL_EVENT, metadata: {
        ...LOCAL_EVENT.metadata, all_day: false, date: '2026-10-13T10:00:00Z', end_date: '2026-10-13T11:00:00Z',
        _provider: provider, _account: `${provider}@example.test`, _calendar_id: '/work/', _etag: '"one"',
    } };
    await act(async () => { root.render(<EventForm mode="edit" eventData={event} initialDate="" calendars={CALENDARS} />); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    const times = [...container.querySelectorAll<HTMLInputElement>('input[type=time]')];
    expect(times.map(input => input.value)).toEqual(['12:00', '13:00']);
    await title('Updated title');
    expect(updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({
        event: expect.objectContaining<Record<string, unknown>>({ start: '2026-10-13T10:00:00Z', end: '2026-10-13T11:00:00Z' }),
    }));
});

it('creates a timed CalDAV event with an optional end and keeps its duration on the next autosave', async () => {
    vi.stubEnv('TZ', 'Europe/Madrid');
    const start = '2026-10-14T10:00:00.000Z';
    const end = '2026-10-14T11:00:00.000Z';
    vi.mocked(createCalendarEvent).mockResolvedValue({ id: 'timed', etag: '"one"', start: { dateTime: start }, end: { dateTime: end } });
    vi.mocked(updateCalendarEvent).mockResolvedValue({ status: 'success', etag: '"two"' });
    await act(async () => { root.render(<EventForm mode="create" eventData={null} initialDate={start} calendars={CALENDARS} defaultCalendarId="caldav" />); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    await title('Created with optional end');
    expect(createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({
        event: expect.objectContaining<Record<string, unknown>>({ start: { dateTime: start, timeZone: 'Europe/Madrid' }, end: { dateTime: end, timeZone: 'Europe/Madrid' } }),
    }));
    await title('Updated title');
    expect(updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({
        event: expect.objectContaining<Record<string, unknown>>({ start, end, etag: '"one"' }),
    }));
    expect(createCalendarEvent).toHaveBeenCalledOnce();
});

it('keeps a floating CalDAV event at its original wall time during a title autosave', async () => {
    vi.stubEnv('TZ', 'Europe/Madrid');
    vi.mocked(updateCalendarEvent).mockResolvedValue({ status: 'success', etag: '"two"' });
    const event = { ...LOCAL_EVENT, metadata: {
        ...LOCAL_EVENT.metadata, all_day: false, date: '2026-10-14T10:00:27', end_date: '2026-10-14T11:00:27',
        _provider: 'caldav', _account: 'caldav@example.test', _calendar_id: '/work/', _etag: '"one"',
    } };
    await act(async () => { root.render(<EventForm mode="edit" eventData={event} initialDate="" calendars={CALENDARS} />); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    expect([...container.querySelectorAll<HTMLInputElement>('input[type=time]')].map(input => input.value)).toEqual(['10:00', '11:00']);
    await title('Changed title');
    expect(updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({
        event: expect.objectContaining<Record<string, unknown>>({ start: '2026-10-14T10:00:27', end: '2026-10-14T11:00:27' }),
    }));
});

it('preserves an aware local reservation instant when its title changes', async () => {
    vi.stubEnv('TZ', 'Europe/Madrid');
    vi.mocked(patchVaultPage).mockResolvedValue(mutation());
    const event = { ...LOCAL_EVENT, metadata: {
        ...LOCAL_EVENT.metadata, all_day: false, date: '2026-10-14T10:00:27Z', end_date: '2026-10-14T11:00:27Z',
    } };
    await act(async () => { root.render(<EventForm mode="edit" eventData={event} initialDate="" calendars={CALENDARS} />); await Promise.resolve(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(160); });
    expect([...container.querySelectorAll<HTMLInputElement>('input[type=time]')].map(input => input.value)).toEqual(['12:00', '13:00']);
    await title('Changed title');
    expect(patchVaultPage).toHaveBeenCalledWith(event.id, expect.objectContaining<Record<string, unknown>>({
        metadata: expect.objectContaining<Record<string, unknown>>({ date: '2026-10-14T10:00:27Z', end_date: '2026-10-14T11:00:27Z' }),
    }));
});

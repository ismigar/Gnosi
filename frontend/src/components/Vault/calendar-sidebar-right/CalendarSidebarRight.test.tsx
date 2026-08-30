import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarSidebarRight } from '../CalendarSidebarRight';
import { EventForm } from './EventForm';
import { createVaultPage, patchVaultPage, deleteVaultPage } from '../../../shared/api/vaults';
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, fetchCalendarFreeBusy, geocodeCalendarLocation, searchCalendarAttendees } from '../../../shared/api/calendar';
import { toast } from '../../../lib/toast';
import { CALENDARS, LOCAL_EVENT, mutation } from './calendarTestFixtures';
import type { EventFormProps } from './calendarTypes';

vi.mock('react-i18next', () => {
    const t = (key: string, fallback?: unknown) => typeof fallback === 'string' ? fallback : key;
    return {useTranslation: () => ({t})};
});
vi.mock('../../../lib/toast', () => ({toast: {error: vi.fn(), success: vi.fn()}}));
vi.mock('../../../shared/api/vaults', () => ({createVaultPage: vi.fn(), patchVaultPage: vi.fn(), deleteVaultPage: vi.fn()}));
vi.mock('../../../shared/api/calendar', () => ({createCalendarEvent: vi.fn(), updateCalendarEvent: vi.fn(), deleteCalendarEvent: vi.fn(), fetchCalendarFreeBusy: vi.fn(), geocodeCalendarLocation: vi.fn(), searchCalendarAttendees: vi.fn()}));
let container: HTMLDivElement;
let root: Root;
beforeAll(() => { (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    vi.mocked(createVaultPage).mockResolvedValue(mutation());
    vi.mocked(patchVaultPage).mockResolvedValue(mutation());
    vi.mocked(createCalendarEvent).mockResolvedValue({id: 'created-external'});
    vi.mocked(updateCalendarEvent).mockResolvedValue({status: 'success'});
    vi.mocked(deleteCalendarEvent).mockResolvedValue({status: 'success'});
});
afterEach(async () => { await act(async () => { root.unmount(); await Promise.resolve(); }); container.remove(); vi.clearAllMocks(); vi.useRealTimers(); });
async function render(node: ReactNode) { await act(async () => { root.render(node); await Promise.resolve(); }); await tick(160); }
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function element<T extends Element>(selector: string, kind: {new(): T}): T {
    const found = container.querySelector(selector); if (!(found instanceof kind)) throw new Error('Missing ' + selector); return found;
}
async function change(selector: string, value: string) {
    const input = element(selector, HTMLInputElement);
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
        input.dispatchEvent(new Event('input', {bubbles: true})); await Promise.resolve();
    });
}
async function select(index: number, value: string) {
    const select = container.querySelectorAll('select')[index]; if (!select) throw new Error('Missing select');
    await act(async () => { select.value = value; select.dispatchEvent(new Event('change', {bubbles: true})); await Promise.resolve(); });
}
async function click(label: string) {
    const button = [...container.querySelectorAll('button')].reverse().find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label || b.firstElementChild?.textContent.trim() === label);
    if (!button) throw new Error('Missing button: ' + label);
    await act(async () => { button.click(); await Promise.resolve(); });
}
function form(props: Partial<EventFormProps> = {}) {
    return <EventForm mode="create" eventData={null} initialDate="2026-09-02" calendars={CALENDARS} {...props} />;
}

describe('calendar sidebar behavior', () => {
    it('does not create empty drafts; autosaves once then patches and flushes on close', async () => {
        const onClose = vi.fn();
        await render(form({onClose}));
        await tick(600);
        expect(createVaultPage).not.toHaveBeenCalled();
        await change('input[required][type=text]', 'New local');
        await tick(460);
        expect(createVaultPage).toHaveBeenCalledOnce();
        expect(createVaultPage).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({title: 'New local', metadata: expect.objectContaining<Record<string, unknown>>({source: 'Gnosi', table_id: 'table-calendar'})}));
        await change('input[required][type=text]', 'Changed locally');
        await click('Close panel');
        expect(patchVaultPage).toHaveBeenCalledWith('local-event', expect.objectContaining<Record<string, unknown>>({title: 'Changed locally'}));
        expect(onClose).toHaveBeenCalledOnce();
    });
    it.each(['google', 'caldav'])('creates and updates %s through the shared provider-neutral adapter', async (provider) => {
        await render(form({defaultCalendarId: provider}));
        await change('input[required][type=text]', 'External meeting'); await tick(460);
        expect(createCalendarEvent).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({email: provider + '@example.test', calendarId: 'primary', event: expect.objectContaining<Record<string, unknown>>({summary: 'External meeting', end: {date: '2026-09-03'}})}));
        expect(createVaultPage).not.toHaveBeenCalled();
        await change('input[required][type=text]', 'Updated external'); await tick(460);
        expect(updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({eventId: 'created-external', email: provider + '@example.test'}));
        expect(createCalendarEvent).toHaveBeenCalledOnce();
    });
    it('initializes editing without saving and preserves recurrence controls', async () => {
        await render(form({mode: 'edit', eventData: {...LOCAL_EVENT, metadata: {...LOCAL_EVENT.metadata, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4'}}}));
        await tick(600); expect(patchVaultPage).not.toHaveBeenCalled();
        expect(container.querySelectorAll('select')[3]?.value).toBe('WEEKLY');
        expect(element('input[type=number]', HTMLInputElement).value).toBe('4');
        await change('input[required][type=text]', 'Recurrent edited'); await tick(460);
        expect(patchVaultPage).toHaveBeenCalledWith('local-event', expect.objectContaining<Record<string, unknown>>({metadata: expect.objectContaining<Record<string, unknown>>({rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4'})}));
    });
    it('edits CalDAV with exclusive end preserved and no vault request', async () => {
        await render(form({mode: 'edit', eventData: {...LOCAL_EVENT, id: 'caldav-existing', metadata: {...LOCAL_EVENT.metadata, end_date: '2026-09-04', _end_exclusive: true, _provider: 'caldav', _account: 'caldav@example.test', _calendar_id: 'work', rrule: ['RRULE:FREQ=DAILY']}}}));
        expect(element('input[type=date][min]', HTMLInputElement).value).toBe('2026-09-03');
        await change('input[required][type=text]', 'CalDAV edit'); await tick(460);
        expect(updateCalendarEvent).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({email: 'caldav@example.test', calendarId: 'work', event: expect.objectContaining<Record<string, unknown>>({end: '2026-09-04'})}));
        expect(patchVaultPage).not.toHaveBeenCalled();
    });
    it('surfaces a failed silent save without a retry loop', async () => {
        vi.mocked(createVaultPage).mockRejectedValueOnce(new Error('offline'));
        await render(form()); await change('input[required][type=text]', 'Offline appointment'); await tick(460);
        expect(container.textContent).toContain('Error desant');
        await tick(2000); expect(createVaultPage).toHaveBeenCalledOnce();
    });
    it('keeps read-only RSVP and does not autosave view edits', async () => {
        const onRsvp = vi.fn();
        await render(form({mode: 'view', onRsvp, eventData: {...LOCAL_EVENT, metadata: {...LOCAL_EVENT.metadata, readonly: true, _account: 'caldav@example.test', attendees: [{email: 'self@example.test', name: 'Me', self: true, rsvp: 'tentative'}]}}}));
        await click('✓ Accept'); expect(onRsvp).toHaveBeenCalledWith('accepted');
        await change('input[required][type=text]', 'Unsaved display'); await tick(600);
        expect(updateCalendarEvent).not.toHaveBeenCalled(); expect(patchVaultPage).not.toHaveBeenCalled();
    });
    it('keeps recurrence instance deletion as an EXDATE patch', async () => {
        await render(form({mode: 'edit', eventData: {...LOCAL_EVENT, metadata: {...LOCAL_EVENT.metadata, rrule: 'FREQ=DAILY'}}}));
        await click('Delete'); await click('Delete');
        expect(container.textContent).toContain('This is a recurring event.');
        await click('Only this instance');
        expect(patchVaultPage).toHaveBeenCalledWith('local-event', {metadata: {exdates: ['2026-09-02']}});
        expect(deleteVaultPage).not.toHaveBeenCalled();
    });
    it('changes calendars without leaving duplicate local drafts', async () => {
        await render(form()); await change('input[required][type=text]', 'Move draft'); await tick(460);
        await select(0, 'caldav'); await tick(460);
        expect(createCalendarEvent).toHaveBeenCalledOnce(); expect(deleteVaultPage).toHaveBeenCalledWith('local-event');
    });
    it('supports attendee suggestions and location keyboard selection', async () => {
        vi.mocked(searchCalendarAttendees).mockResolvedValue([{email: 'guest@example.test', name: 'Guest'}]);
        vi.mocked(geocodeCalendarLocation).mockResolvedValue([{label: 'Library', lat: 41, lon: 2}]);
        await render(form());
        await change('input[placeholder="Add by email or name..."]', 'gu'); await tick(310); await click('Guestguest@example.test');
        expect(container.textContent).toContain('Guest');
        await change('input[autocomplete=off]', 'Lib'); await tick(360);
        const input = element('input[autocomplete=off]', HTMLInputElement);
        await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true})); await Promise.resolve(); });
        await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true})); await Promise.resolve(); });
        expect(input.value).toBe('Library');
        expect(container.querySelector('a[href*="openstreetmap.org"]')).not.toBeNull();
    });
    it('shows search results, switches to availability and excludes busy slots', async () => {
        vi.mocked(fetchCalendarFreeBusy).mockResolvedValue({calendars: {primary: {busy: [{start: '2026-09-02T09:00:00', end: '2026-09-02T10:00:00'}]}}});
        const onEventEdit = vi.fn();
        await render(<CalendarSidebarRight searchQuery="Local" onSearchChange={vi.fn()} onEventEdit={onEventEdit} allNotes={[LOCAL_EVENT]} calendars={CALENDARS} />);
        await click('Local appointment2026-09-02'); expect(onEventEdit).toHaveBeenCalledWith('local-event');
        await click('Availability'); await change('input[type=date]', '2026-09-02'); await click('calendar.availability.search_btn');
        expect(fetchCalendarFreeBusy).toHaveBeenCalledWith(expect.objectContaining<Record<string, unknown>>({email: 'google@example.test', calendarIds: ['primary'], timeMin: new Date('2026-09-02T00:00:00').toISOString()}));
        expect(container.textContent).toContain('10:00 - 10:30');
        expect(container.textContent).not.toContain('09:00 - 09:30');
        expect(toast.error).not.toHaveBeenCalled();
    });
});

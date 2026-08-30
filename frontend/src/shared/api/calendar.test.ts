import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchCalendarList,
  fetchCalendarFreeBusy,
  rsvpCalendarEvent,
} from './calendar';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('calendar API', () => {
  it('preserves the partial-account authentication header', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json([], {
        headers: { 'X-Calendar-Auth-Error': 'expired@example.com' },
        status: 200,
      })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchCalendarList()).resolves.toEqual({
      authError: 'expired@example.com',
      items: [],
    });
  });


  it('serializes free-busy fields as the generated request body', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ calendars: {} }, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchCalendarFreeBusy({
      calendarIds: ['primary'],
      email: 'user@example.com',
      timeMax: '2026-08-30T00:00:00Z',
      timeMin: '2026-08-29T00:00:00Z',
    });
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(new URL(request.url).searchParams.get('email')).toBe('user@example.com');
    await expect(request.clone().json()).resolves.toEqual({
      calendar_ids: ['primary'],
      time_max: '2026-08-30T00:00:00Z',
      time_min: '2026-08-29T00:00:00Z',
    });
  });


  it('sends RSVP values through the typed event operation', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ ok: true, rsvp: 'accepted' }, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await rsvpCalendarEvent({
      email: 'user@example.com',
      eventId: 'event/1',
      rsvp: 'accepted',
    });
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(new URL(request.url).pathname).toBe('/api/calendar/events/event%2F1/rsvp');
  });
});

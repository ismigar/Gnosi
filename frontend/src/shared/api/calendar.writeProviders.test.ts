import { afterEach, expect, it, vi } from 'vitest';
import { resetApiTestStorage } from '../../../tests/api-request';
import { deleteCalendarEvent, updateCalendarEvent } from './calendar';

afterEach(() => { resetApiTestStorage(); vi.unstubAllGlobals(); });

it.each(['google', 'caldav'])('retains the explicit %s provider in PATCH and DELETE requests', async provider => {
  resetApiTestStorage();
  const fetchMock = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ status: 'success' })));
  vi.stubGlobal('fetch', fetchMock);
  const input = { email: 'owner@example.test', calendarId: '/work/', eventId: 'event', provider };
  await updateCalendarEvent({ ...input, event: { provider, summary: 'Changed' } });
  await deleteCalendarEvent(input);
  const patch = fetchMock.mock.calls[0]?.[0];
  const deletion = fetchMock.mock.calls[1]?.[0];
  if (!(patch instanceof Request) || !(deletion instanceof Request)) throw new Error('Expected generated client requests');
  expect(patch.method).toBe('PATCH');
  await expect(patch.clone().json()).resolves.toEqual({ provider, summary: 'Changed' });
  expect(deletion.method).toBe('DELETE');
  expect(new URL(deletion.url).searchParams.get('provider')).toBe(provider);
  expect(new URL(deletion.url).searchParams.get('calendar_id')).toBe('/work/');
});

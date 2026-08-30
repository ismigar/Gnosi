import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchDailyNotes, openDailyNote } from './daily-notes';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('daily notes API', () => {
  it('lists existing notes and opens one date through typed routes', async () => {
    const notes = [{ id: 'daily-1', date: '2026-08-29', title: 'Today' }];
    const document = { id: 'daily-1', title: 'Today', content: '' };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(notes))
      .mockResolvedValueOnce(Response.json(document));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchDailyNotes()).resolves.toEqual(notes);
    await expect(openDailyNote({ date: '2026-08-29' })).resolves.toEqual(document);

    const listRequest = fetchMock.mock.calls[0]?.[0];
    const openRequest = fetchMock.mock.calls[1]?.[0];
    if (!(listRequest instanceof Request) || !(openRequest instanceof Request)) {
      throw new Error('Expected Request instances');
    }
    expect(listRequest.method).toBe('GET');
    expect(openRequest.method).toBe('POST');
    expect(new URL(openRequest.url).pathname).toBe('/api/vault/daily');
    await expect(openRequest.clone().json()).resolves.toEqual({ date: '2026-08-29' });
  });
});

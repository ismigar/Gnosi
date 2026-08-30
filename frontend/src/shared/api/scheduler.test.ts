import { resetApiTestStorage } from '../../test/api-request';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchScheduledTasks, updateScheduledTask } from './scheduler';


afterEach(() => {
  resetApiTestStorage();
  vi.unstubAllGlobals();
});


describe('scheduler API', () => {
  it('loads scheduled tasks through the generated client', async () => {
    const tasks = [
      {
        description: 'Fetch feeds',
        enabled: true,
        interval_minutes: 120,
        last_run: null,
        name: 'fetch_feeds',
        next_run: null,
        status: 'idle',
      },
    ];
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(tasks, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchScheduledTasks()).resolves.toEqual(tasks);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe('/api/schedulers');
  });


  it('updates a task with path and body values from the typed contract', async () => {
    const task = {
      description: 'Fetch feeds',
      enabled: false,
      interval_minutes: 60,
      last_run: null,
      name: 'fetch_feeds',
      next_run: null,
      status: 'idle',
    };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ success: true, task }, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      updateScheduledTask({
        name: 'fetch_feeds',
        update: { enabled: false, interval_minutes: 60 },
      }),
    ).resolves.toEqual({ success: true, task });
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(request.method).toBe('PUT');
    expect(new URL(request.url).pathname).toBe('/api/schedulers/fetch_feeds');
    await expect(request.clone().json()).resolves.toEqual({
      enabled: false,
      interval_minutes: 60,
    });
  });
});

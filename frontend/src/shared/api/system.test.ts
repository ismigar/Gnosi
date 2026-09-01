import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  browseFilesystem,
  createSystemNotification,
  fetchSystemHealth,
  searchFilesystem,
} from './system';


afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});


describe('system API', () => {
  it('loads public health through the generated client and forwards cancellation', async () => {
    const payload = {
      gnosi_mode: 'native',
      mode: 'FastAPI',
      require_auth: false,
      status: 'ok',
      vault_configured: true,
    };
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(payload, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSystemHealth(controller.signal)).resolves.toEqual(payload);
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(request.method).toBe('GET');
    expect(new URL(request.url).pathname).toBe('/api/health');
    expect(request.signal.aborted).toBe(false);
    controller.abort();
    expect(request.signal.aborted).toBe(true);
  });


  it('browses through the generated client and preserves recoverable errors', async () => {
    const payload = {
      error: 'Path does not exist',
      error_code: 'not_found',
      roots: { home: '/Users/test', root: '/', vault: '/vault' },
    };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(payload, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(browseFilesystem('/missing')).resolves.toEqual(payload);
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request).toBeInstanceOf(Request);
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/system/browse');
    await expect(request.clone().json()).resolves.toEqual({ path: '/missing' });
  });


  it('searches with the bounded typed payload', async () => {
    const payload = {
      results: [{ is_dir: false, name: 'note.md', path: '/vault/note.md' }],
      truncated: false,
    };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(payload, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(searchFilesystem({ limit: 200, query: 'note' })).resolves.toEqual(
      payload,
    );
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    await expect(request.clone().json()).resolves.toEqual({
      limit: 200,
      query: 'note',
    });
  });


  it('creates a notification with request context and compatibility defaults', async () => {
    localStorage.setItem('gnosi_workspace_id', 'workspace-1');
    const payload = {
      created_at: '2026-08-29T10:00:00Z',
      id: 'notification-1',
      is_read: false,
      level: 'ERROR',
      message: 'Could not save',
      title: '[editor]',
      workspace_id: 'workspace-1',
    };
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json(payload, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      createSystemNotification({
        level: 'ERROR',
        message: 'Could not save',
        title: '[editor]',
        workspace_id: 'workspace-1',
      }),
    ).resolves.toEqual(payload);
    const request = fetchMock.mock.calls[0]?.[0];
    if (!(request instanceof Request)) throw new Error('Expected a Request instance');
    expect(request.headers.get('X-Workspace-ID')).toBe('workspace-1');
    await expect(request.clone().json()).resolves.toEqual({
      level: 'ERROR',
      message: 'Could not save',
      title: '[editor]',
      workspace_id: 'workspace-1',
    });
  });
});

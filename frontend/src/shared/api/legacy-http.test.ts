import { afterEach, describe, expect, it, vi } from 'vitest';

import legacyHttp from './legacy-http';


afterEach(() => {
  vi.unstubAllGlobals();
});


describe('legacyHttp', () => {
  it('preserves Axios-style params, interceptors and response data', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response(JSON.stringify({ value: 3 }), {
          headers: { 'Content-Type': 'application/json', ETag: 'rev-3' },
          status: 200,
        })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const requestId = legacyHttp.interceptors.request.use((config) => ({
      ...config,
      headers: { ...config.headers, 'X-Test': 'yes' },
    }));
    const responseId = legacyHttp.interceptors.response.use((response) => ({
      ...response,
      data: { ...response.data as object, intercepted: true },
    }));

    try {
      const response = await legacyHttp.get('/api/example', {
        params: { page: 2, tag: ['a', 'b'] },
      });

      expect(response.data).toEqual({ value: 3, intercepted: true });
      expect(response.headers['etag']).toBe('rev-3');
      expect(response.headers.get('ETag')).toBe('rev-3');
      const [input, init] = fetchMock.mock.calls[0] ?? [];
      expect(input).toBe('/api/example?page=2&tag=a&tag=b');
      expect(new Headers(init?.headers).get('X-Test')).toBe('yes');
      expect(init?.credentials).toBe('include');
    } finally {
      legacyHttp.interceptors.request.eject(requestId);
      legacyHttp.interceptors.response.eject(responseId);
    }
  });

  it('serializes JSON bodies and exposes Axios-compatible errors', async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      expect(init?.body).toBe(JSON.stringify({ title: 'Page' }));
      expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json');
      return Promise.resolve(new Response(JSON.stringify({ detail: 'No access' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 403,
        statusText: 'Forbidden',
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(legacyHttp.post('/api/pages', { title: 'Page' })).rejects.toMatchObject({
      isAxiosError: true,
      response: {
        data: { detail: 'No access' },
        status: 403,
      },
    });
  });

  it('retains cancellation detection', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(() =>
        Promise.reject(new DOMException('aborted', 'AbortError')),
      ),
    );

    try {
      await legacyHttp.get('/api/slow', { signal: controller.signal });
      throw new Error('Expected cancellation');
    } catch (error) {
      expect(legacyHttp.isCancel(error)).toBe(true);
      expect(error).toMatchObject({ code: 'ERR_CANCELED', name: 'CanceledError' });
    }
  });
});

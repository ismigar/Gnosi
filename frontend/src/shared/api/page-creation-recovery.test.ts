import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBrowserLocks } from '../../../tests/browser-locks';
import { requestAt, resetApiTestStorage, writeApiTestStorage } from '../../../tests/api-request';
import { createRecoverablePage, pendingPageCreations } from './page-creation-recovery';

const input = { title: 'QA', content: '', metadata: { zero: 0, checked: false }, force: false, is_database: false };
const result = { id: 'page', title: 'QA', content: '', metadata: input.metadata, folder: '', status: 'created', message: 'created' };
beforeEach(installBrowserLocks);
afterEach(() => { resetApiTestStorage(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('durable page creation identity', () => {
  it('recovers after a lost response and module reload without another POST', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('connection lost'))
      .mockResolvedValueOnce(Response.json({ status: 'completed', page_id: 'page', result }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createRecoverablePage(input)).rejects.toThrow('connection lost');
    const pending = pendingPageCreations();
    expect(pending).toHaveLength(1);
    vi.resetModules();
    const reloaded = await import('./page-creation-recovery');
    expect(reloaded.pendingPageCreations()[0]?.key).toBe(pending[0]?.key);
    await expect(reloaded.createRecoverablePage(input)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAt(fetchMock.mock.calls, 1).method).toBe('GET');
    expect(reloaded.pendingPageCreations()).toHaveLength(0);
  });

  it.each(['pending', 'unknown'])('does not send a new creation when status is %s', async status => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('lost'))
      .mockResolvedValueOnce(Response.json({ status, page_id: 'page', result: null }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createRecoverablePage(input)).rejects.toThrow();
    await expect(createRecoverablePage(input)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAt(fetchMock.mock.calls, 1).method).toBe('GET');
    expect(pendingPageCreations()).toHaveLength(1);
  });

  it('resubmits an absent reservation using exactly the original key', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('lost'))
      .mockResolvedValueOnce(Response.json({ detail: 'Not found' }, { status: 404 }))
      .mockResolvedValueOnce(Response.json(result));
    vi.stubGlobal('fetch', fetchMock);
    await expect(createRecoverablePage(input)).rejects.toThrow();
    await expect(createRecoverablePage(input)).resolves.toEqual(result);
    expect(requestAt(fetchMock.mock.calls, 0).headers.get('Idempotency-Key'))
      .toBe(requestAt(fetchMock.mock.calls, 2).headers.get('Idempotency-Key'));
    expect(pendingPageCreations()).toHaveLength(0);
  });

  it('shares simultaneous submissions but permits a new identical page after success', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(Response.json(result)));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([createRecoverablePage(input), createRecoverablePage({ ...input })]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await createRecoverablePage(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestAt(fetchMock.mock.calls, 0).headers.get('Idempotency-Key'))
      .not.toBe(requestAt(fetchMock.mock.calls, 1).headers.get('Idempotency-Key'));
  });

  it('isolates pending identities between vaults and pins request headers', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('lost'));
    vi.stubGlobal('fetch', fetchMock);
    writeApiTestStorage('gnosi_active_vault', 'first');
    await expect(createRecoverablePage(input)).rejects.toThrow();
    const key = pendingPageCreations()[0]?.key;
    writeApiTestStorage('gnosi_active_vault', 'second');
    expect(pendingPageCreations()).toHaveLength(0);
    await expect(createRecoverablePage(input)).rejects.toThrow();
    expect(pendingPageCreations()[0]?.key).not.toBe(key);
    expect([0, 1].map(index => requestAt(fetchMock.mock.calls, index).headers.get('X-Vault-ID'))).toEqual(['first', 'second']);
    writeApiTestStorage('gnosi_active_vault', 'first');
    expect(pendingPageCreations()[0]?.key).toBe(key);
  });

  it('does not submit a write if its identity cannot be persisted', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await expect(createRecoverablePage(input)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shares one identity across independent window modules while the first POST is waiting', async () => {
    vi.resetModules();
    const otherWindow = await import('./page-creation-recovery');
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetchMock = vi.fn<typeof fetch>(request => {
      if (new Request(request).method === 'POST') return gate.then(() => Response.json(result));
      release();
      return Promise.resolve(Response.json({ status: 'pending', page_id: 'page', result: null }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const results = await Promise.allSettled([createRecoverablePage(input), otherWindow.createRecoverablePage(input)]);
    expect(results.map(item => item.status)).toEqual(['fulfilled', 'rejected']);
    expect(fetchMock.mock.calls.map((_, index) => requestAt(fetchMock.mock.calls, index).method)).toEqual(['POST', 'GET']);
    expect(pendingPageCreations()).toHaveLength(0);
  });

  it('acknowledging a completed creation preserves another window’s uncertain creation', async () => {
    vi.resetModules();
    const otherWindow = await import('./page-creation-recovery');
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetchMock = vi.fn<typeof fetch>(request => {
      return new Request(request).json().then((body: unknown) => {
        if (typeof body === 'object' && body !== null && 'title' in body && body.title === 'Other') {
          return Promise.reject(new TypeError('lost'));
        }
        return gate.then(() => Response.json(result));
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = createRecoverablePage(input);
    await expect(otherWindow.createRecoverablePage({ ...input, title: 'Other' })).rejects.toThrow('lost');
    expect(pendingPageCreations()).toHaveLength(2);
    release(); await first;
    expect(pendingPageCreations().map(item => item.title)).toEqual(['Other']);
  });

  it('does not silently submit without browser-wide coordination', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', {});
    await expect(createRecoverablePage(input)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pendingPageCreations()).toHaveLength(0);
  });
});

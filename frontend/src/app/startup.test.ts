import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  calls: [] as string[],
  routing: vi.fn<() => Promise<void>>(),
  preload: vi.fn<() => Promise<void>>(),
  health: vi.fn<() => Promise<unknown>>(),
}));
vi.mock('../shared/resources/fileResourcePaths', () => ({
  syncActiveVaultCookie: () => { mocks.calls.push('cookie'); },
}));
vi.mock('../shared/routing/vaultRouting', () => ({ initializeVaultRouting: mocks.routing }));
vi.mock('./routePreload', () => ({ preloadApplicationRoute: mocks.preload }));
vi.mock('../shared/api/system', () => ({ fetchSystemHealth: mocks.health }));

import { startApplication } from './startup';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.routing.mockReset().mockImplementation(() => {
    mocks.calls.push('routing');
    return Promise.resolve();
  });
  mocks.preload.mockReset().mockImplementation(() => {
    mocks.calls.push('preload');
    return Promise.resolve();
  });
  mocks.health.mockReset().mockImplementation(() => {
    mocks.calls.push('health');
    return Promise.resolve({});
  });
});

afterEach(() => { vi.useRealTimers(); });

describe('overlapping application startup', () => {
  it('starts routing and the application download independently, with the vault cookie ready', async () => {
    const routing = deferred<undefined>();
    mocks.routing.mockImplementation(() => { mocks.calls.push('routing'); return routing.promise; });
    const mounted = vi.fn();
    const bootstrap = vi.fn(async (ready: Promise<void>) => {
      await ready;
      mounted();
    });
    const application = deferred<{ bootstrap: typeof bootstrap }>();
    const load = vi.fn(() => { mocks.calls.push('download'); return application.promise; });
    const pending = startApplication(load);
    await Promise.resolve();
    expect(mocks.calls).toEqual(['cookie', 'routing', 'health']);
    await vi.waitFor(() => { expect(load).toHaveBeenCalledOnce(); });
    expect(mocks.calls).toEqual(['cookie', 'routing', 'health', 'preload', 'download']);
    expect(mounted).not.toHaveBeenCalled();
    application.resolve({ bootstrap });
    await vi.waitFor(() => { expect(bootstrap).toHaveBeenCalledOnce(); });
    expect(mounted).not.toHaveBeenCalled();
    routing.resolve(undefined);
    await pending;
    expect(mocks.routing).toHaveBeenCalledOnce();
    expect(mounted).toHaveBeenCalledOnce();
  });

  it('dispatches API transports across middleware microtasks before importing chunks without waiting for responses', async () => {
    vi.useFakeTimers();
    const routing = deferred<undefined>();
    const health = deferred<undefined>();
    const middleware = async (name: string, response: Promise<undefined>): Promise<void> => {
      // Model the asynchronous query setup and header middleware before fetch.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      mocks.calls.push(`${name}-transport`);
      await response;
    };
    mocks.routing.mockImplementation(() => middleware('routing', routing.promise));
    mocks.health.mockImplementation(() => middleware('health', health.promise));
    const mounted = vi.fn();
    const bootstrap = vi.fn(async (ready: Promise<void>) => { await ready; mounted(); });
    const load = vi.fn(() => { mocks.calls.push('download'); return Promise.resolve({ bootstrap }); });
    const pending = startApplication(load);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.calls).toEqual(['cookie', 'routing-transport', 'health-transport', 'preload', 'download']);
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(mounted).not.toHaveBeenCalled();
    routing.resolve(undefined);
    await pending;
    expect(mounted).toHaveBeenCalledOnce();
    expect(mocks.routing).toHaveBeenCalledOnce();
    expect(mocks.health).toHaveBeenCalledOnce();
    health.resolve(undefined);
  });

  it('does not wait for a speculative route chunk before starting the shell', async () => {
    mocks.preload.mockReturnValue(new Promise(() => undefined));
    const bootstrap = vi.fn(async (ready: Promise<void>) => { await ready; });
    await startApplication(() => Promise.resolve({ bootstrap }));
    expect(bootstrap).toHaveBeenCalledOnce();
  });

  it.each(['pending', 'failed'])('does not block the shell on a %s health preparation', async outcome => {
    mocks.health.mockImplementation(() => outcome === 'failed'
      ? Promise.reject(new Error('Health unavailable'))
      : new Promise(() => undefined));
    const bootstrap = vi.fn(async (ready: Promise<void>) => { await ready; });
    await startApplication(() => Promise.resolve({ bootstrap }));
    expect(bootstrap).toHaveBeenCalledOnce();
  });

  it('handles routing failure while the application is still downloading', async () => {
    const routing = deferred<undefined>();
    mocks.routing.mockReturnValue(routing.promise);
    const bootstrap = vi.fn(async (ready: Promise<void>) => { await ready; });
    const application = deferred<{ bootstrap: typeof bootstrap }>();
    const pending = startApplication(() => application.promise);
    const failure = expect(pending).rejects.toThrow('Routing failed');
    routing.reject(new Error('Routing failed'));
    await failure;
    application.resolve({ bootstrap });
    await vi.waitFor(() => { expect(bootstrap).toHaveBeenCalledOnce(); });
  });

  it('propagates an application download failure', async () => {
    await expect(startApplication(() => Promise.reject(new Error('Download failed'))))
      .rejects.toThrow('Download failed');
  });
});

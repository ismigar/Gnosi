import { describe, expect, it, vi } from 'vitest';
import { runtimeHarness } from './runtime-test-support';

describe('serialized plugin API v2', () => {
  it('initializes without parent imports and advertises readiness exactly once', () => {
    const { api, postMessage } = runtimeHarness();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ __gnosi: true, type: 'ready' }, '*');
    expect(Object.keys(api).sort()).toEqual([
      'error', 'fetch', 'log', 'registerCommand', 'registerSettingsPanel',
      'registerSidebarPanel', 'registerView', 'settings', 'vault', 'warn',
    ]);
  });

  it('preserves contribution defaults, coercible identifiers, namespaces and heights', () => {
    const { api, postMessage, deliver } = runtimeHarness();
    const command = vi.fn(); const view = vi.fn(); const panel = vi.fn(); const settings = vi.fn();
    api.registerCommand(); api.registerCommand({ id: '' }); api.registerView(null);
    api.registerSidebarPanel(null); api.registerSettingsPanel();
    expect(postMessage).toHaveBeenCalledOnce();
    api.registerCommand({ id: 42, run: command });
    api.registerView({ id: 42, title: 'View', icon: 'book', render: view });
    api.registerSidebarPanel({ id: '42', render: panel });
    api.registerSettingsPanel({ id: '42', height: 9999, render: settings });
    expect(postMessage.mock.calls.slice(1)).toEqual([
      [{ __gnosi: true, type: 'register-command', id: 42, title: 42, icon: null }, '*'],
      [{ __gnosi: true, type: 'register-view', id: 42, title: 'View', icon: 'book' }, '*'],
      [{ __gnosi: true, type: 'register-panel', id: '42', title: '42' }, '*'],
      [{ __gnosi: true, type: 'register-settings-panel', id: '42', title: '42', height: 1200 }, '*'],
    ]);
    for (const kind of ['cmd', 'view', 'panel', 'settings']) deliver({ __gnosi_host: true, type: 'run', kind, id: '42', arg: { exact: kind } });
    expect(command).toHaveBeenCalledWith({ exact: 'cmd' }); expect(view).toHaveBeenCalledWith({ exact: 'view' });
    expect(panel).toHaveBeenCalledWith({ exact: 'panel' }); expect(settings).toHaveBeenCalledWith({ exact: 'settings' });
    api.registerSettingsPanel({ id: 'small', height: -10 });
    expect(postMessage.mock.lastCall?.[0]).toMatchObject({ height: 160 });
    api.registerSettingsPanel({ id: 'default', height: 0 });
    expect(postMessage.mock.lastCall?.[0]).toMatchObject({ height: 420 });
    const custom = vi.fn();
    api.registerCommand({ id: { toString: () => 'coerced' }, run: custom });
    deliver({ __gnosi_host: true, type: 'run', kind: 'cmd', id: 'coerced' });
    expect(custom).toHaveBeenCalledOnce();
  });

  it('overwrites callbacks by id, reports thrown errors and rejects foreign senders', () => {
    const { api, deliver, postMessage } = runtimeHarness();
    const old = vi.fn(); const current = vi.fn();
    api.registerCommand({ id: 'same', run: old }); api.registerCommand({ id: 'same', run: current });
    const run = { __gnosi_host: true, type: 'run', kind: 'cmd', id: 'same', arg: 'exact' };
    deliver(run, {}); deliver(run, null); deliver(null); deliver('invalid'); deliver({ ...run, __gnosi_host: false });
    expect(current).not.toHaveBeenCalled();
    deliver(run); expect(current).toHaveBeenCalledExactlyOnceWith('exact'); expect(old).not.toHaveBeenCalled();
    api.registerCommand({ id: 'throws', run: () => { throw new Error('callback failure'); } });
    deliver({ ...run, id: 'throws' });
    expect(postMessage.mock.lastCall).toEqual([{ __gnosi: true, type: 'log', level: 'error', message: 'Error: callback failure' }, '*']);
  });

  it('preserves every host RPC payload and correlates results by sequence', async () => {
    const { api, deliver, postMessage } = runtimeHarness();
    const requests = [
      api.vault.readPage('page/one'), api.vault.writePage('page/one', 'new text'),
      api.vault.writePage('page/one', { pageId: 'override', metadata: { tag: ['a'] }, content: '' }),
      api.vault.createPage(), api.vault.queryDB('table', { limit: 0 }), api.vault.queryDB('table', { limit: 3 }),
      api.vault.listTables(), api.settings.get(), api.settings.set({ accent: 'blue' }),
      api.fetch('https://example.test/', { method: 'POST', body: 'exact' }),
    ];
    const expected = [
      ['vault.readPage', { pageId: 'page/one' }], ['vault.writePage', { pageId: 'page/one', content: 'new text' }],
      ['vault.writePage', { pageId: 'override', metadata: { tag: ['a'] }, content: '' }], ['vault.createPage', {}],
      ['vault.queryDB', { tableId: 'table', limit: 200 }], ['vault.queryDB', { tableId: 'table', limit: 3 }],
      ['vault.listTables', {}], ['settings.get', {}], ['settings.set', { settings: { accent: 'blue' } }],
      ['network.fetch', { url: 'https://example.test/', opts: { method: 'POST', body: 'exact' } }],
    ];
    expect(postMessage.mock.calls.slice(1)).toEqual(expected.map(([method, args], i) => [
      { __gnosi: true, type: 'host-call', id: `c${String(i + 1)}`, method, args }, '*',
    ]));
    // Reverse delivery proves replies do not depend on arrival order.
    for (let i = requests.length; i > 0; i -= 1) deliver({ __gnosi_host: true, type: 'host-result', id: `c${String(i)}`, ok: true, result: i });
    await expect(Promise.all(requests)).resolves.toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('does not resolve a request from a foreign window or replay duplicate replies', async () => {
    const { api, deliver, postMessage } = runtimeHarness(); const resolved = vi.fn();
    const request = api.settings.get().then(resolved);
    const reply = { __gnosi_host: true, type: 'host-result', id: 'c1', ok: true, result: 'exact' };
    deliver(reply, {}); deliver({ ...reply, id: 'unknown' }); await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    deliver(reply); deliver({ ...reply, result: 'duplicate' }); await request;
    expect(resolved).toHaveBeenCalledExactlyOnceWith('exact'); expect(postMessage).toHaveBeenCalledTimes(2);
  });

  it.each([['rejected', 'rejected'], ['', 'host error'], [{ toString: (): string => 'legacy error' }, 'legacy error']])(
    'preserves error coercion and rejection without resending (%s)', async (error, message) => {
      const { api, deliver, postMessage } = runtimeHarness();
      const request = api.settings.get();
      const assertion = expect(request).rejects.toThrow(message);
      deliver({ __gnosi_host: true, type: 'host-result', id: 'c1', ok: false, error });
      await assertion; expect(postMessage).toHaveBeenCalledTimes(2);
    },
  );

  it('preserves log levels and legacy argument joining', () => {
    const { api, postMessage } = runtimeHarness();
    api.log('value', null, undefined, 4); api.warn('warning'); api.error('error');
    expect(postMessage.mock.calls.slice(1)).toEqual([
      [{ __gnosi: true, type: 'log', level: 'info', message: 'value   4' }, '*'],
      [{ __gnosi: true, type: 'log', level: 'warn', message: 'warning' }, '*'],
      [{ __gnosi: true, type: 'log', level: 'error', message: 'error' }, '*'],
    ]);
  });
});

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
const privilegedEvent = Object.freeze({ sender: { send: () => assert.fail('Privileged API called') } });

function loadBridge(responses = {}) {
  const ipc = new EventEmitter();
  const calls = [];
  const exposed = new Map();
  ipc.invoke = async (channel, ...args) => {
    calls.push({ channel, args });
    assert.ok(Object.hasOwn(responses, channel), `Unconfigured IPC channel: ${channel}`);
    const value = responses[channel];
    if (value instanceof Error) throw value;
    return value;
  };
  const electron = {
    ipcRenderer: ipc,
    contextBridge: {
      exposeInMainWorld: (name, api) => {
        assert.ok(!exposed.has(name));
        exposed.set(name, api);
      },
    },
  };
  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, 'electron', 'The sandboxed preload must not require local runtime modules');
      return electron;
    },
  }, { filename: 'preload.js' });
  assert.deepEqual([...exposed.keys()], ['electronAPI']);
  return { api: exposed.get('electronAPI'), ipc, calls };
}

test('exposes only the named application methods, never generic IPC primitives', () => {
  const { api } = loadBridge();
  assert.deepEqual(Object.keys(api).sort(), [
    'downloadUpdate', 'getAppVersion', 'getBackendStatus', 'getBackendURL',
    'getUpdateStatus', 'installUpdate', 'onOpenSettings', 'onUpdateStatus',
    'openFormFiller', 'removeOpenSettingsListener', 'removeUpdateListener',
    'setApplicationMenu',
  ].sort());
  for (const method of Object.values(api)) assert.equal(typeof method, 'function');
});

test('every bridge request has a main-process handler and a declared channel', () => {
  const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const contract = fs.readFileSync(path.join(__dirname, 'ipc-contract.d.ts'), 'utf8');
  const requests = [...source.matchAll(/invoke\('([^']+)'/g)].map((match) => match[1]);
  const handlers = [...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((match) => match[1]);
  assert.equal(new Set(requests).size, requests.length);
  assert.deepEqual(requests.sort(), handlers.sort());
  for (const channel of requests) assert.ok(contract.includes(`'${channel}'`));
});

test('invokes every channel with its exact existing arguments and response', async () => {
  const update = { status: 'available', version: '3.0.0-rc.1', installMode: 'automatic' };
  const { api, calls } = loadBridge({
    'get-app-version': '2.0.6',
    'get-backend-status': { running: true },
    'get-backend-url': 'http://localhost:5002',
    'get-update-status': update,
    'download-update': { ...update, status: 'downloading', percent: 12.5 },
    'install-update': { ...update, status: 'downloaded' },
    'set-application-menu': true,
    'open-form-filler': undefined,
  });
  assert.equal(await api.getAppVersion(), '2.0.6');
  assert.deepEqual({ ...await api.getBackendStatus() }, { running: true });
  assert.equal(await api.getBackendURL(), 'http://localhost:5002');
  assert.strictEqual(await api.getUpdateStatus(), update);
  assert.equal((await api.downloadUpdate()).percent, 12.5);
  assert.equal((await api.installUpdate()).status, 'downloaded');
  const labels = { settings: 'Configuració' };
  const profile = { email: 'fixture@example.invalid' };
  assert.equal(await api.setApplicationMenu(labels), true);
  assert.equal(await api.openFormFiller('https://example.invalid/form', profile), undefined);
  assert.deepEqual(structuredClone(calls), [
    { channel: 'get-app-version', args: [] },
    { channel: 'get-backend-status', args: [] },
    { channel: 'get-backend-url', args: [] },
    { channel: 'get-update-status', args: [] },
    { channel: 'download-update', args: [] },
    { channel: 'install-update', args: [] },
    { channel: 'set-application-menu', args: [{ labels }] },
    { channel: 'open-form-filler', args: [{ url: 'https://example.invalid/form', profile }] },
  ]);
});

test('preserves transport rejection rather than reporting an operation as successful', async () => {
  const failure = new Error('Fictitious IPC failure');
  const { api } = loadBridge({ 'download-update': failure });
  await assert.rejects(api.downloadUpdate(), (error) => error === failure);
});

test('rejects invalid response types at each request boundary', async () => {
  for (const [method, channel, invalid] of [
    ['getAppVersion', 'get-app-version', 3],
    ['getBackendURL', 'get-backend-url', null],
    ['getBackendStatus', 'get-backend-status', { running: 'yes' }],
    ['getUpdateStatus', 'get-update-status', null],
    ['downloadUpdate', 'download-update', { status: 'unknown' }],
    ['installUpdate', 'install-update', { status: 'downloaded', percent: '100' }],
    ['setApplicationMenu', 'set-application-menu', 'true'],
    ['openFormFiller', 'open-form-filler', { unexpected: true }],
  ]) {
    const { api } = loadBridge({ [channel]: invalid });
    await assert.rejects(api[method](), { name: 'TypeError' });
  }
});

test('settings notifications contain no Electron event or unexpected data', () => {
  const { api, ipc } = loadBridge();
  const received = [];
  api.onOpenSettings((...args) => received.push(args));
  ipc.emit('open-settings', privilegedEvent, { sender: privilegedEvent.sender });
  assert.deepEqual(received, [[]]);
});

test('update notifications forward only the validated state, including all main-process statuses', () => {
  const { api, ipc } = loadBridge();
  const received = [];
  api.onUpdateStatus((...args) => received.push(args));
  for (const status of ['idle', 'checking', 'not-available', 'available', 'downloading',
    'downloaded', 'manual-download', 'error']) {
    const state = { status, percent: 4.5, userInitiated: false, error: undefined };
    ipc.emit('update-status', privilegedEvent, state);
    assert.deepEqual(received.at(-1), [state]);
  }
});

test('malformed notifications cannot reach a renderer listener', () => {
  const { api, ipc } = loadBridge();
  let called = false;
  api.onUpdateStatus(() => { called = true; });
  for (const state of [null, [], 'idle', {}, { status: 'future' },
    { status: 'downloading', percent: NaN }, { status: 'idle', percent: Infinity },
    { status: 'idle', installMode: 'shell' }, { status: 'idle', version: 3 },
    { status: 'error', error: {} }, { status: 'idle', userInitiated: 'yes' }]) {
    assert.throws(() => ipc.emit('update-status', privilegedEvent, state), { name: 'TypeError' });
  }
  assert.equal(called, false);
});

for (const [method, channel, legacyRemove, payload] of [
  ['onOpenSettings', 'open-settings', 'removeOpenSettingsListener', undefined],
  ['onUpdateStatus', 'update-status', 'removeUpdateListener', { status: 'idle' }],
]) {
  test(`${channel}: disposer is idempotent and removes only its own subscription`, () => {
    const { api, ipc } = loadBridge();
    let first = 0;
    let second = 0;
    const dispose = api[method](() => { first += 1; });
    const disposeSecond = api[method](() => { second += 1; });
    ipc.emit(channel, privilegedEvent, payload);
    dispose();
    dispose();
    ipc.emit(channel, privilegedEvent, payload);
    assert.equal(first, 1);
    assert.equal(second, 2);
    assert.equal(ipc.listenerCount(channel), 1);
    disposeSecond();
    assert.equal(ipc.listenerCount(channel), 0);
  });

  test(`${channel}: legacy removal remains compatible and old disposers cannot remove a new subscription`, () => {
    const { api, ipc } = loadBridge();
    let called = 0;
    const callback = () => { called += 1; };
    const dispose = api[method](callback);
    api[legacyRemove]();
    assert.equal(ipc.listenerCount(channel), 0);
    api[method](callback);
    dispose();
    ipc.emit(channel, privilegedEvent, payload);
    assert.equal(called, 1);
    api[legacyRemove]();
  });

  test(`${channel}: rejects invalid callbacks before registering a listener`, () => {
    const { api, ipc } = loadBridge();
    assert.throws(() => api[method](null), { name: 'TypeError' });
    assert.equal(ipc.listenerCount(channel), 0);
  });
}

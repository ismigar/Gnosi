const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { registerIpcHandlers } = require('./ipc-handlers');
const { normalizeMenuLabels, createApplicationMenuTemplate } = require('./application-menu');
const { buildMacInstallerUrl, getUpdateInstallMode } = require('./update-policy');

const CHANNELS = [
  'get-app-version', 'set-application-menu', 'get-update-status', 'get-backend-url',
  'download-update', 'get-backend-status', 'install-update', 'open-form-filler',
];

function fixture({ isDev = false, platform = 'darwin', arch = 'arm64', overrides = {} } = {}) {
  const handlers = new Map();
  const effects = [];
  const sender = {
    mainFrame: { url: isDev ? 'http://localhost:5173/vault' : 'app://gnosi/vault', detached: false },
    isDestroyed: () => false,
  };
  const window = { webContents: sender, isDestroyed: () => false };
  const event = { sender, senderFrame: sender.mainFrame };
  const mainWindows = new Set([window]);
  let state = { status: 'idle', installMode: getUpdateInstallMode(platform) };
  const dependencies = {
    ipcMain: { handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `Duplicate channel ${channel}`);
      handlers.set(channel, handler);
    } },
    mainWindows,
    isDev,
    getAppVersion: () => { effects.push('version'); return '3.0.0-rc.1'; },
    getBackendURL: () => { effects.push('backend-url'); return 'http://localhost:5002'; },
    getBackendStatus: () => { effects.push('backend-status'); return Promise.resolve({ running: true }); },
    getUpdateState: () => { effects.push('state'); return state; },
    publishUpdateState: patch => { effects.push({ patch }); state = { ...state, ...patch }; },
    installApplicationMenu: labels => { effects.push({ labels }); },
    buildMacInstallerUrl: version => {
      effects.push({ installerVersion: version });
      return buildMacInstallerUrl(version, arch);
    },
    openExternal: url => { effects.push({ external: url }); return Promise.resolve(); },
    downloadUpdate: () => { effects.push('download'); return Promise.resolve(['/fixture/update']); },
    quitAndInstall: () => { effects.push('install'); },
    createFormFillerWindow: options => {
      const window = {
        webContents: Object.assign(new EventEmitter(), {
          executeJavaScript: script => { effects.push({ script }); return Promise.resolve(); },
        }),
        loadURL: url => { effects.push({ formUrl: url }); return Promise.resolve(); },
      };
      effects.push({ formWindow: window, options });
      return window;
    },
    log: (...messages) => { effects.push({ log: messages }); },
    ...overrides,
  };
  registerIpcHandlers(dependencies);
  return {
    handlers, dependencies, effects, mainWindows, sender, window, event,
    invoke: (channel, ...args) => handlers.get(channel)(event, ...args),
    state: () => state,
    setState: next => { state = next; },
  };
}

for (const isDev of [false, true]) {
  test(`real registration accepts the trusted ${isDev ? 'development' : 'packaged'} renderer`, async () => {
    const f = fixture({ isDev });
    assert.deepEqual([...f.handlers.keys()], CHANNELS);
    assert.equal(await f.invoke('get-app-version'), '3.0.0-rc.1');
    assert.equal(await f.invoke('get-backend-url'), 'http://localhost:5002');
    assert.deepEqual(await f.invoke('get-backend-status'), { running: true });
    assert.equal(await f.invoke('get-update-status'), f.state());
    assert.equal(await f.invoke('download-update'), f.state());
    assert.equal(await f.invoke('install-update'), f.state());
    assert.equal(await f.invoke('set-application-menu', { labels: { settings: 'Configuració' } }), true);
    assert.equal(await f.invoke('open-form-filler', { url: 'https://example.invalid/form', profile: {} }), undefined);
    assert.equal(f.effects.filter(effect => effect.formWindow).length, 1);
    assert.equal(f.effects.includes('download'), false);
    assert.equal(f.effects.includes('install'), false);
  });
}

for (const [name, corrupt] of [
  ['unregistered window', f => f.mainWindows.clear()],
  ['destroyed window', f => { f.window.isDestroyed = () => true; }],
  ['destroyed sender', f => { f.sender.isDestroyed = () => true; }],
  ['remote origin', f => { f.sender.mainFrame.url = 'https://example.invalid'; }],
  ['lookalike authority', f => { f.sender.mainFrame.url = 'app://gnosi.evil'; }],
  ['detached frame', f => { f.sender.mainFrame.detached = true; }],
  ['destroyed frame', f => { f.sender.mainFrame.isDestroyed = () => true; }],
  ['missing frame', f => { f.event.senderFrame = null; }],
  ['same-origin child frame', f => { f.event.senderFrame = { url: f.sender.mainFrame.url }; }],
  ['stale frame', f => { f.sender.mainFrame = { url: f.sender.mainFrame.url }; }],
  ['throwing native getter', f => { f.sender.isDestroyed = () => { throw new Error('fixture native error'); }; }],
]) {
  test(`all extracted handlers reject ${name} before decoding or touching dependencies`, async () => {
    const f = fixture();
    corrupt(f);
    const payload = new Proxy({}, { get() { assert.fail('Payload inspected before sender guard'); } });
    for (const channel of CHANNELS) {
      await assert.rejects(async () => f.invoke(channel, payload), /Untrusted IPC sender/);
      assert.deepEqual(f.effects, []);
    }
  });
}

for (const channel of CHANNELS.filter(channel => !['set-application-menu', 'open-form-filler'].includes(channel))) {
  test(`${channel} rejects extra arguments before reading state or acting`, async () => {
    const f = fixture();
    for (const args of [[undefined], [null], [{}], ['bad'], [0, false]]) {
      await assert.rejects(async () => f.invoke(channel, ...args), /Unexpected IPC arguments/);
      assert.deepEqual(f.effects, []);
    }
  });
}

test('menu defaults, omitted envelope, blank labels and locale labels preserve the existing normalizer', async () => {
  const installed = [];
  const f = fixture({ overrides: { installApplicationMenu: labels => installed.push(normalizeMenuLabels(labels)) } });
  for (const args of [[], [undefined], [{}], [{ labels: undefined }], [{ labels: {} }]]) {
    assert.equal(await f.invoke('set-application-menu', ...args), true);
    assert.deepEqual(installed.at(-1), normalizeMenuLabels());
  }
  for (const settings of ['Configuració', 'Configuración', 'Paramètres', 'Settings']) {
    assert.equal(await f.invoke('set-application-menu', { labels: { settings, file: '  ', help: ' Ajuda ' } }), true);
    const labels = installed.at(-1);
    assert.equal(labels.settings, settings);
    assert.equal(labels.file, 'File');
    assert.equal(labels.help, 'Ajuda');
    for (const isMac of [true, false]) {
      let clicked = false;
      const template = createApplicationMenuTemplate({ labels, isMac, onOpenSettings: () => { clicked = true; } });
      const item = template.flatMap(menu => menu.submenu).find(entry => entry.label === settings);
      assert.ok(item);
      item.click();
      assert.equal(clicked, true);
    }
  }
});

test('menu rejects malformed envelopes and values without partial installation', async () => {
  const f = fixture();
  for (const payload of [null, [], 4, true, 'labels', new Date(), new Map(),
    { labels: null }, { labels: [] }, { labels: 1 }, { labels: 'text' },
    { labels: { settings: null } }, { labels: { settings: 4 } },
    { labels: { settings: 'Configuració', help: {} } }]) {
    await assert.rejects(async () => f.invoke('set-application-menu', payload), /Invalid menu/);
    assert.deepEqual(f.effects, []);
  }
  await assert.rejects(async () => f.invoke('set-application-menu', {}, {}), /Unexpected menu arguments/);
  assert.deepEqual(f.effects, []);
});

test('menu data named __proto__ remains an own string property, without prototype mutation', async () => {
  const f = fixture();
  const labels = JSON.parse('{"__proto__":"fixture","settings":"Configuració"}');
  assert.equal(await f.invoke('set-application-menu', { labels }), true);
  const decoded = f.effects[0].labels;
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.equal(Object.hasOwn(decoded, '__proto__'), true);
  assert.equal(decoded.__proto__, 'fixture');
  assert.equal(decoded.settings, 'Configuració');
});

test('backend status delegates exactly once to the async owner and preserves false/rejection', async () => {
  let calls = 0;
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = fixture({ overrides: { getBackendStatus: () => { calls += 1; return pending; } } });
  const result = f.invoke('get-backend-status');
  assert.equal(calls, 1);
  assert.equal(result, pending);
  finish({ running: false });
  assert.deepEqual(await result, { running: false });
  assert.deepEqual(f.effects, []);
  const failure = new Error('fixture owner failed');
  const rejected = fixture({ overrides: { getBackendStatus: () => Promise.reject(failure) } });
  await assert.rejects(rejected.invoke('get-backend-status'), error => error === failure);
});

for (const arch of ['arm64', 'x64']) {
  test(`macOS ${arch} opens the manual installer once and cannot install automatically`, async () => {
    const f = fixture({ arch });
    f.setState({ status: 'available', installMode: 'manual', version: '3.0.0-rc.1', error: 'old' });
    const result = await f.invoke('download-update');
    assert.equal(result, f.state());
    assert.deepEqual(result, {
      status: 'manual-download', installMode: 'manual', version: '3.0.0-rc.1',
      userInitiated: true, error: undefined,
    });
    assert.deepEqual(f.effects.filter(effect => effect.external), [{
      external: `https://github.com/ismigar/Gnosi/releases/download/v3.0.0-rc.1/Gnosi-3.0.0-rc.1-${arch}.dmg`,
    }]);
    assert.equal(f.effects.includes('download'), false);
    f.setState({ ...result, status: 'downloaded' });
    await f.invoke('install-update');
    assert.equal(f.effects.includes('install'), false);
  });
}

for (const platform of ['linux', 'win32']) {
  test(`${platform} awaits the actual download callback and returns the latest owner state`, async () => {
    let finish;
    const pending = new Promise(resolve => { finish = resolve; });
    const f = fixture({ platform, overrides: { downloadUpdate: () => { f.effects.push('download'); return pending; } } });
    f.setState({ status: 'available', installMode: getUpdateInstallMode(platform), version: '3.0.0-rc.1' });
    const result = f.invoke('download-update');
    assert.equal(f.state().userInitiated, true);
    f.dependencies.publishUpdateState({ status: 'downloading', percent: 42 });
    finish(['/fixture/update']);
    assert.equal(await result, f.state());
    assert.equal((await result).percent, 42);
    assert.equal(f.effects.filter(effect => effect === 'download').length, 1);
    assert.equal(f.effects.some(effect => effect.external || effect.installerVersion), false);
    f.setState({ ...f.state(), status: 'downloaded', error: 'old' });
    const installed = await f.invoke('install-update');
    assert.equal(installed.error, undefined);
    assert.equal(installed.userInitiated, true);
    assert.equal(f.effects.filter(effect => effect === 'install').length, 1);
  });
}

test('ineligible update states are unchanged and trigger no actions or publications', async () => {
  for (const status of ['idle', 'checking', 'not-available', 'downloading', 'manual-download', 'error']) {
    const f = fixture();
    const state = { status, installMode: 'automatic' };
    f.setState(state);
    assert.equal(await f.invoke('download-update'), state);
    assert.equal(await f.invoke('install-update'), state);
    assert.ok(f.effects.every(effect => effect === 'state'));
  }
});

for (const [name, overrides, initial, expected] of [
  ['manual open failure', { openExternal: () => Promise.reject(new Error('browser unavailable')) },
    { status: 'available', installMode: 'manual', version: '3.0.0-rc.1' }, 'browser unavailable'],
  ['manual invalid version', {}, { status: 'available', installMode: 'manual', version: 'bad-version' },
    'Cannot build an update URL for an invalid version'],
  ['automatic download failure', { downloadUpdate: () => Promise.reject(new Error('download failed')) },
    { status: 'available', installMode: 'automatic' }, 'download failed'],
  ['automatic installation failure', { quitAndInstall: () => { throw new Error('install failed'); } },
    { status: 'downloaded', installMode: 'automatic' }, 'install failed'],
  ['non-Error rejection', { downloadUpdate: () => Promise.reject(null) },
    { status: 'available', installMode: 'automatic' }, 'Unknown update error'],
  ['cross-realm rejection', { downloadUpdate: () => Promise.reject(vm.runInNewContext('new Error("remote failure")')) },
    { status: 'available', installMode: 'automatic' }, 'remote failure'],
]) {
  test(`${name} returns and publishes the error state`, async () => {
    const f = fixture({ overrides });
    f.setState(initial);
    const result = await f.invoke(initial.status === 'downloaded' ? 'install-update' : 'download-update');
    assert.equal(result, f.state());
    assert.equal(result.status, 'error');
    assert.equal(result.error, expected);
    assert.equal(result.userInitiated, true);
    assert.ok(f.effects.some(effect => effect.patch?.status === 'error'));
    assert.ok(f.effects.some(effect => effect.log?.includes(expected)));
  });
}

test('the unchanged preload invokes the extracted channels with their actual wire envelopes', async () => {
  const f = fixture();
  const ipc = new EventEmitter();
  ipc.invoke = (channel, ...args) => Promise.resolve(f.invoke(channel, ...args));
  let api;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8'), {
    require(name) {
      assert.equal(name, 'electron');
      return { ipcRenderer: ipc, contextBridge: { exposeInMainWorld(_name, bridge) { api = bridge; } } };
    },
  });
  assert.equal(await api.getAppVersion(), '3.0.0-rc.1');
  assert.equal(await api.getBackendURL(), 'http://localhost:5002');
  assert.equal((await api.getBackendStatus()).running, true);
  assert.equal(await api.getUpdateStatus(), f.state());
  assert.equal(await api.downloadUpdate(), f.state());
  assert.equal(await api.installUpdate(), f.state());
  assert.equal(await api.setApplicationMenu({ settings: 'Configuració' }), true);
  assert.deepEqual(f.effects.at(-1), { labels: { settings: 'Configuració' } });
  assert.equal(await api.openFormFiller('https://example.invalid/form', { email: 'synthetic@example.invalid' }), undefined);
  const formWindow = f.effects.find(effect => effect.formWindow).formWindow;
  assert.equal(f.mainWindows.has(formWindow), false);
  formWindow.webContents.emit('did-finish-load');
  assert.ok(f.effects.at(-1).script.includes('"email":"synthetic@example.invalid"'));
});

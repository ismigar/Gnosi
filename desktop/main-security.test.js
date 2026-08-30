const assert = require('node:assert/strict');
const test = require('node:test');
const { loadMainRuntime, senderEvent } = require('./test-helpers/main-runtime.cjs');

const CHANNELS = [
  'get-app-version', 'set-application-menu', 'get-update-status', 'get-backend-url',
  'download-update', 'get-backend-status', 'install-update', 'open-form-filler',
];
const FORM = { url: 'https://example.invalid/form', profile: { email: 'fixture@example.invalid' } };

function argumentsFor(channel) {
  if (channel === 'open-form-filler') return [FORM];
  if (channel === 'set-application-menu') return [{ labels: { settings: 'Configuració' } }];
  return [];
}

for (const isDev of [false, true]) {
  test(`all eight handlers accept the registered top-level ${isDev ? 'development' : 'packaged'} renderer`, async () => {
    const runtime = loadMainRuntime({ isDev });
    const window = runtime.createWindow();
    assert.deepEqual([...runtime.handlers.keys()], CHANNELS);
    assert.equal(await runtime.handlers.get('get-app-version')(senderEvent(window)), '3.0.0-rc.1');
    for (const channel of CHANNELS) {
      await runtime.handlers.get(channel)(senderEvent(window), ...argumentsFor(channel));
    }
    assert.ok(runtime.calls.includes('menu-installed'));
    assert.ok(runtime.calls.some(call => call.healthUrl === 'http://localhost:5002/api/system/stats'));
    assert.equal(runtime.windows.length, 2);
    const filler = runtime.windows[1];
    assert.equal(filler.options.webPreferences.nodeIntegration, false);
    assert.equal(filler.options.webPreferences.contextIsolation, true);
    assert.equal(filler.options.webPreferences.sandbox, true);
    assert.equal(filler.options.webPreferences.webSecurity, true);
    assert.equal(filler.options.webPreferences.preload, undefined);
    assert.equal(runtime.mainWindows.has(filler), false);
    assert.equal(runtime.calls.some(call => call === 'download' || call === 'install'), false);
  });
}

for (const [name, mutate] of [
  ['unregistered window', (runtime, window) => { runtime.mainWindows.delete(window); }],
  ['remote origin', (_runtime, window) => { window.webContents.mainFrame.url = 'https://example.invalid'; }],
  ['lookalike authority', (_runtime, window) => { window.webContents.mainFrame.url = 'app://gnosi.evil/index.html'; }],
  ['destroyed window', (_runtime, window) => { window.destroyed = true; }],
  ['detached frame', (_runtime, window) => { window.webContents.mainFrame.detached = true; }],
]) {
  test(`all handlers reject ${name} before reading data or executing an action`, async () => {
    const runtime = loadMainRuntime();
    const window = runtime.createWindow();
    mutate(runtime, window);
    runtime.calls.length = 0;
    for (const channel of CHANNELS) {
      await assert.rejects(async () => runtime.handlers.get(channel)(senderEvent(window), ...argumentsFor(channel)), /Untrusted IPC sender/);
      assert.deepEqual(runtime.calls, []);
    }
  });
}

test('same-origin child frames and stale top-level frames cannot use privileged handlers', async () => {
  const runtime = loadMainRuntime();
  const window = runtime.createWindow();
  const oldFrame = window.webContents.mainFrame;
  await window.loadURL('app://gnosi/vault');
  for (const frame of [null, oldFrame, { url: 'app://gnosi/vault' }]) {
    runtime.calls.length = 0;
    for (const channel of CHANNELS) {
      await assert.rejects(async () => runtime.handlers.get(channel)(senderEvent(window, frame), ...argumentsFor(channel)), /Untrusted IPC sender/);
    }
    assert.deepEqual(runtime.calls, []);
  }
});

test('downloads and installs remain explicit actions restricted to a trusted window', async () => {
  const runtime = loadMainRuntime();
  const window = runtime.createWindow();
  runtime.setUpdateState({ status: 'available', version: '3.0.0-rc.1', installMode: 'automatic' });
  await runtime.handlers.get('download-update')(senderEvent(window));
  assert.equal(runtime.calls.filter(call => call === 'download').length, 1);
  runtime.setUpdateState({ status: 'downloaded', version: '3.0.0-rc.1', installMode: 'automatic' });
  await runtime.handlers.get('install-update')(senderEvent(window));
  assert.equal(runtime.calls.filter(call => call === 'install').length, 1);
});

test('trusted main windows retain sandbox and block cross-origin navigation and redirects', () => {
  for (const isDev of [true, false]) {
    const runtime = loadMainRuntime({ isDev });
    const window = runtime.createWindow();
    assert.equal(window.options.webPreferences.nodeIntegration, false);
    assert.equal(window.options.webPreferences.contextIsolation, true);
    assert.equal(window.options.webPreferences.sandbox, true);
    assert.equal(window.options.webPreferences.webSecurity, true);
    for (const name of ['will-navigate', 'will-redirect']) {
      for (const url of ['https://example.invalid', 'file:///tmp/private', 'app://other/vault', 'http://localhost:51730']) {
        let prevented = false;
        window.webContents.emit(name, { preventDefault: () => { prevented = true; } }, url);
        assert.equal(prevented, true);
      }
      window.webContents.emit(name, { preventDefault: () => assert.fail('Trusted navigation was blocked') },
        isDev ? 'http://localhost:5173/vault?tab=one#heading' : 'app://gnosi/vault?tab=one#heading');
    }
    const result = window.openHandler({ url: 'https://example.invalid/link' });
    assert.equal(result.action, 'deny');
    assert.ok(runtime.calls.some(call => call.external === 'https://example.invalid/link'));
  }
});

test('application protocol rejects other authorities before reaching the backend', async () => {
  const runtime = loadMainRuntime();
  const handler = runtime.protocols.get('app');
  for (const url of ['app://other/api/health', 'app://gnosi:80/api/health', 'app://user@gnosi/api/health', 'https://gnosi/api/health']) {
    const response = await handler({ url, get headers() { assert.fail('Untrusted protocol request was processed'); } });
    assert.equal(response.status, 403);
    assert.deepEqual(runtime.calls, []);
  }
  const response = await handler(new Request('app://gnosi/api/health?fixture=1'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.deepEqual(structuredClone(runtime.calls), [{ backendUrl: 'http://localhost:5002/api/health?fixture=1', method: 'GET' }]);
});

test('form windows cannot load privileged schemes or credentials in URLs', async () => {
  const runtime = loadMainRuntime();
  const window = runtime.createWindow();
  for (const url of ['file:///tmp/private', 'javascript:alert(1)', 'data:text/html,test', 'https://user:password@example.invalid']) {
    runtime.calls.length = 0;
    await assert.rejects(runtime.handlers.get('open-form-filler')(senderEvent(window), { ...FORM, url }), /Unsupported form URL/);
    assert.deepEqual(runtime.calls, []);
  }
});

test('form autofill does not log the supplied profile', async () => {
  const runtime = loadMainRuntime();
  const window = runtime.createWindow();
  await runtime.handlers.get('open-form-filler')(senderEvent(window), FORM);
  runtime.windows[1].webContents.emit('did-finish-load');
  const script = runtime.calls.find(call => call.script)?.script;
  assert.ok(script);
  assert.doesNotMatch(script, /console\.[a-z]+\([^\n]*profile/);
  assert.ok(!JSON.stringify(runtime.calls.filter(call => call.log)).includes('fixture@example.invalid'));
});

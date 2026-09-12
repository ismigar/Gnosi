const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { loadMainRuntime } = require('./test-helpers/main-runtime.cjs');
const { backendStartupMessage } = require('./startup-errors');

function assertMenusCannotStart(runtime) {
  const windowsBefore = runtime.windows.length;
  const callsBefore = runtime.calls.length;
  runtime.clickMenu('New Window');
  runtime.clickMenu('Settings…');
  if (!runtime.calls.includes('devtools')) runtime.clickMenu('Check for Updates…');
  assert.equal(runtime.windows.length, windowsBefore);
  assert.equal(runtime.calls.length, callsBefore);
}

test('missing packaged executable does not fall back to system Python or open a window', async () => {
  const runtime = loadMainRuntime({ initialize: false, bundleExists: false });
  await runtime.readyCallbacks[0]();
  assert.equal(runtime.windows.length, 0);
  assert.ok(runtime.calls.includes('quit'));
  assert.ok(runtime.calls.some(call => call.errorBox?.message.includes('Reinstall Gnosi')));
  assert.equal(runtime.calls.includes('check-updates'), false);
  assertMenusCannotStart(runtime);
  runtime.lifecycle.get('activate')();
  assert.equal(runtime.windows.length, 0);
});

test('a supervisor startup rejection prevents the renderer, updater and activation bypass', async () => {
  const runtime = loadMainRuntime({ initialize: false, bundleExists: true,
    launchBackend: async () => { throw new Error('Backend startup timed out'); },
  });
  await runtime.readyCallbacks[0]();
  assert.equal(runtime.windows.length, 0);
  assert.ok(runtime.calls.includes('quit'));
  assert.ok(runtime.calls.some(call => call.errorBox?.message.includes('Quit and reopen')));
  runtime.lifecycle.get('activate')();
  assert.equal(runtime.windows.length, 0);
  assert.equal(runtime.calls.includes('check-updates'), false);
  assertMenusCannotStart(runtime);
});

for (const isDev of [false, true]) {
  test(`actual ${isDev ? 'development' : 'packaged'} startup waits for owned readiness`, async () => {
    let acknowledge;
    const ready = new Promise(resolve => { acknowledge = resolve; });
    const child = new EventEmitter();
    let launchOptions;
    const runtime = loadMainRuntime({ initialize: false, bundleExists: !isDev, isDev,
      launchBackend: async options => {
        launchOptions = options;
        options.onSpawn(child);
        await ready;
        return { process: child, isRunning: async () => true };
      },
    });
    const startup = runtime.readyCallbacks[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(runtime.windows.length, 0);
    runtime.clickMenu('New Window');
    runtime.clickMenu('Settings…');
    if (!isDev) runtime.clickMenu('Check for Updates…');
    assert.equal(runtime.windows.length, 0);
    assert.equal(runtime.calls.includes('check-updates'), false);
    runtime.lifecycle.get('activate')();
    assert.equal(runtime.windows.length, 0);
    assert.equal(launchOptions.healthUrl, `http://localhost:${isDev ? 5002 : 43123}/api/health`);
    if (isDev) {
      assert.equal(launchOptions.executable, 'python3');
      assert.deepEqual(Array.from(launchOptions.args), ['-m', 'uvicorn', 'backend.server:app', '--host', '127.0.0.1', '--port', '5002']);
    } else {
      assert.equal(launchOptions.executable, '/fixture/resources/python/cervell_backend');
      assert.equal(launchOptions.environment.GNOSI_DATA_DIR, '/fixture/user-data');
      assert.equal(launchOptions.environment.BACKEND_PORT, '43123');
    }
    acknowledge();
    await startup;
    assert.equal(runtime.windows.length, 1);
    assert.equal((await runtime.getBackendStatus()).running, true);
    assert.equal(runtime.calls.some(call => call.errorBox), false);
    child.emit('exit', 1);
    assertMenusCannotStart(runtime);
    runtime.windows[0].emit('ready-to-show');
    assert.equal(runtime.calls.includes('window-shown'), false);
    runtime.mainWindows.clear();
    runtime.lifecycle.get('activate')();
    assert.equal(runtime.windows.length, 1);
  });
}

test('quit waits for owned child cleanup and cannot create a window after shutdown starts', async () => {
  let acknowledge;
  let finishStop;
  const ready = new Promise(resolve => { acknowledge = resolve; });
  const stopped = new Promise(resolve => { finishStop = resolve; });
  const child = new EventEmitter();
  let stopCount = 0;
  const runtime = loadMainRuntime({ initialize: false, bundleExists: true,
    launchBackend: async options => {
      options.onSpawn(child);
      await ready;
      return { process: child, isRunning: async () => true };
    },
    stopBackend: async actual => { assert.equal(actual, child); stopCount++; await stopped; },
  });
  const startup = runtime.readyCallbacks[0]();
  await new Promise(resolve => setImmediate(resolve));
  let prevented = false;
  runtime.lifecycle.get('before-quit')({ preventDefault: () => { prevented = true; } });
  assert.ok(prevented);
  assert.equal(stopCount, 1);
  assert.equal(runtime.calls.includes('quit'), false);
  assertMenusCannotStart(runtime);
  acknowledge();
  await startup;
  assert.equal(runtime.windows.length, 0);
  assertMenusCannotStart(runtime);
  finishStop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.calls.includes('quit'), true);
});

test('ready menu actions work but delayed settings sends stop after backend exit', async () => {
  const child = new EventEmitter();
  const runtime = loadMainRuntime({ initialize: false, bundleExists: true,
    launchBackend: async options => {
      options.onSpawn(child);
      return { process: child, isRunning: async () => true };
    },
  });
  await runtime.readyCallbacks[0]();
  runtime.clickMenu('New Window');
  assert.equal(runtime.windows.length, 2);
  const newest = runtime.windows[1];
  newest.emit('ready-to-show');
  assert.ok(runtime.calls.includes('window-shown'));
  runtime.clickMenu('Settings…');
  assert.equal(runtime.calls.filter(call => call.channel === 'open-settings').length, 1);
  newest.webContents.isLoading = () => true;
  runtime.clickMenu('Settings…');
  child.emit('exit', 1);
  newest.webContents.emit('did-finish-load');
  assert.equal(runtime.calls.filter(call => call.channel === 'open-settings').length, 1);
  assertMenusCannotStart(runtime);
});

test('quit before Electron readiness cannot start the backend or create a window', async () => {
  const runtime = loadMainRuntime({ initialize: false });
  runtime.lifecycle.get('before-quit')({ preventDefault: () => assert.fail('No child to reap') });
  await runtime.readyCallbacks[0]();
  assert.equal(runtime.windows.length, 0);
  assert.equal(runtime.handlers.size, 0);
});

for (const [locale, title, recovery] of [
  ['en-US', 'backend startup', 'Reinstall Gnosi'],
  ['ca-ES', 'arrencada del backend', 'Torna a instal·lar Gnosi'],
  ['es-ES', 'inicio del backend', 'Vuelve a instalar Gnosi'],
  ['fr-FR', 'démarrage du backend', 'Réinstallez Gnosi'],
]) {
  test(`pre-render startup failure is localized for ${locale}`, async () => {
    const runtime = loadMainRuntime({ initialize: false, locale });
    await runtime.readyCallbacks[0]();
    const dialog = runtime.calls.find(call => call.errorBox).errorBox;
    assert.ok(dialog.title.includes(title));
    assert.ok(dialog.message.includes(recovery));
    const generic = backendStartupMessage(locale, new Error('Synthetic private diagnostic'));
    assert.ok(generic.title.includes(title));
    assert.doesNotMatch(generic.message, /5002/);
    assert.doesNotMatch(generic.message, /Synthetic private diagnostic/);
  });
}

test('unknown native locale uses English recovery text', () => {
  assert.deepEqual(backendStartupMessage('de-DE', null), backendStartupMessage('en', null));
  assert.deepEqual(backendStartupMessage('CA_es', null), backendStartupMessage('ca', null));
});


test('second launch reopens a closed main window after successful startup', async () => {
  const runtime = loadMainRuntime({ initialize: false, bundleExists: true,
    launchBackend: async () => ({ isRunning: async () => true }),
  });
  await runtime.readyCallbacks[0]();
  runtime.windows[0].emit('closed');
  runtime.lifecycle.get('second-instance')();
  assert.equal(runtime.windows.length, 2);
});

test('quit during port selection cannot spawn a backend afterwards', async () => {
  let releasePort;
  const pendingPort = new Promise(resolve => { releasePort = resolve; });
  const runtime = loadMainRuntime({ initialize: false, bundleExists: true,
    selectBackendPort: () => pendingPort,
    launchBackend: () => assert.fail('Quit must prevent a new child'),
  });
  const startup = runtime.readyCallbacks[0]();
  runtime.lifecycle.get('before-quit')({ preventDefault: () => assert.fail('No owned child') });
  releasePort(43123);
  await startup;
  assert.equal(runtime.windows.length, 0);
});

test('unconfigured packaged startup completes native folder selection before opening any renderer', async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-main-setup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, 'vault');
  fs.mkdirSync(vault);
  let launches = 0;
  let stops = 0;
  const runtime = loadMainRuntime({ initialize: false, bundleExists: true,
    userDataPath: path.join(root, 'data'), locale: 'ca-ES',
    showOpenDialog: async options => {
      assert.equal(stops, 1);
      assert.equal(runtime.windows.length, 0);
      assert.equal(options.title, 'Tria la biblioteca de Gnosi');
      return { canceled: false, filePaths: [vault] };
    },
    launchBackend: async options => {
      launches++;
      const child = new EventEmitter();
      options.onSpawn(child);
      if (launches === 2) assert.equal(options.environment.DIGITAL_BRAIN_VAULT_PATH, vault);
      return { process: child, vaultConfigured: launches === 2, isRunning: async () => true,
        stop: async () => { stops++; child.emit('exit', 0); } };
    },
  });
  await runtime.readyCallbacks[0]();
  assert.equal(launches, 2);
  assert.equal(runtime.windows.length, 1);
  assert.equal(runtime.calls.includes('quit'), false);
});

test('canceling initial folder selection quits without opening a window or starting updates', async () => {
  let stops = 0;
  const runtime = loadMainRuntime({ initialize: false, bundleExists: true,
    launchBackend: async options => {
      const child = new EventEmitter();
      options.onSpawn(child);
      return { process: child, vaultConfigured: false, stop: async () => { stops++; child.emit('exit', 0); } };
    },
  });
  await runtime.readyCallbacks[0]();
  assert.equal(stops, 1);
  assert.equal(runtime.windows.length, 0);
  assert.equal(runtime.calls.includes('quit'), true);
  assert.equal(runtime.calls.includes('check-updates'), false);
  runtime.lifecycle.get('activate')();
  assert.equal(runtime.windows.length, 0);
});

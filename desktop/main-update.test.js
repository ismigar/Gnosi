const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { loadMainRuntime } = require('./test-helpers/main-runtime.cjs');

async function fixture(options = {}) {
  const child = new EventEmitter();
  const runtime = loadMainRuntime({ initialize: false, bundleExists: true,
    launchBackend: async ({ onSpawn }) => {
      onSpawn(child);
      return { process: child, isRunning: async () => true };
    }, ...options,
  });
  await runtime.readyCallbacks[0]();
  const window = runtime.windows[0];
  const event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  runtime.setUpdateState({ status: 'downloaded', version: '3.0.1', installMode: 'automatic' });
  return { runtime, event };
}

test('native replacement waits for backend shutdown and requests silent relaunch', async () => {
  let stopped;
  const shutdown = new Promise(resolve => { stopped = resolve; });
  const { runtime, event } = await fixture({ stopBackend: () => shutdown });
  const installing = runtime.handlers.get('install-update')(event);
  assert.equal(runtime.calls.includes('install'), false);
  stopped();
  await installing;
  assert.deepEqual(runtime.calls.find(call => call.installOptions).installOptions, [true, true]);
  assert.equal(runtime.calls.filter(call => call === 'install').length, 1);
  let prevented = false;
  runtime.lifecycle.get('before-quit')({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test('a backend shutdown failure leaves the current application installed', async () => {
  const { runtime, event } = await fixture({ stopBackend: async () => { throw new Error('Still saving'); } });
  const state = await runtime.handlers.get('install-update')(event);
  assert.equal(runtime.calls.includes('install'), false);
  assert.equal(state.status, 'error');
  assert.equal(state.error, 'Still saving');
});

test('an asynchronous native installer error restores the stopped backend', async () => {
  let starts = 0;
  const { runtime, event } = await fixture({
    launchBackend: async ({ onSpawn }) => {
      starts += 1;
      const child = new EventEmitter();
      onSpawn(child);
      return { process: child, isRunning: async () => true };
    },
  });
  await runtime.handlers.get('install-update')(event);
  runtime.updater.emit('error', new Error('Installer rejected'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 2);
  assert.equal((await runtime.getBackendStatus()).running, true);
});

test('long-running sessions recheck quietly without interrupting an update', async () => {
  const { runtime } = await fixture();
  const timer = runtime.intervals[0];
  assert.equal(timer.milliseconds, 6 * 60 * 60 * 1000);
  const initialChecks = runtime.calls.filter(call => call === 'check-updates').length;
  for (const status of ['available', 'downloading', 'downloaded', 'installing']) {
    runtime.setUpdateState({ status });
    timer.callback();
  }
  assert.equal(runtime.calls.filter(call => call === 'check-updates').length, initialChecks);
  runtime.setUpdateState({ status: 'not-available' });
  timer.callback();
  assert.equal(runtime.calls.filter(call => call === 'check-updates').length, initialChecks + 1);
});

for (const platform of ['win32', 'linux']) {
  test(`${platform} keeps the existing updater and stops its backend before replacement`, async () => {
    const sequence = [];
    const {runtime,event}=await fixture({platform,stopBackend:async()=>{sequence.push('stopped');}});
    runtime.updater.quitAndInstall=(...args)=>sequence.push(args);
    await runtime.handlers.get('install-update')(event);
    assert.deepEqual(sequence,['stopped',[true,true]]);
    assert.equal(runtime.updater.autoDownload,false);
    assert.equal(runtime.updater.autoInstallOnAppQuit,false);
  });
}

test('a packaged ad-hoc Mac uses Sparkle and the same download-to-restart IPC', async () => {
  const sequence=[];
  const sparkle=Object.assign(new EventEmitter(),{
    checkForUpdates:async()=>{},
    downloadUpdate:async()=>{sequence.push('download');sparkle.emit('download-progress',{percent:45});sparkle.emit('update-downloaded',{version:'3.0.1'});},
    quitAndInstall:()=>sequence.push('install'),
  });
  const {runtime,event}=await fixture({isPackaged:true,sparkleUpdater:sparkle,stopBackend:async()=>{sequence.push('stopped');}});
  sparkle.emit('update-available',{version:'3.0.1'});
  const state=await runtime.handlers.get('get-update-status')(event);
  assert.equal(state.installMode,'automatic');
  await runtime.handlers.get('download-update')(event);
  assert.deepEqual(sequence,['download','stopped','install']);
  assert.ok(runtime.calls.some(call=>call.channel==='update-status' && call.payload.percent===45));
});

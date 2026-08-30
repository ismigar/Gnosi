const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { prepareDesktopProfile } = require('./profile-startup');
const { loadMainRuntime } = require('./test-helpers/main-runtime.cjs');

function fixture({ ready = false, lock = true, name = '@gnosi/desktop', separateSession = false } = {}) {
  const events = [];
  const profile = path.resolve('/fixture/profile');
  const app = {
    isReady: () => ready,
    getName: () => name,
    setName: value => { name = value; events.push(`name:${value}`); },
    requestSingleInstanceLock: () => { events.push('lock'); return lock; },
    getPath: key => { events.push(key); return separateSession && key === 'sessionData' ? `${profile}-session` : profile; },
  };
  const preserve = (directory, configured) => { events.push({ directory, configured }); };
  return { app, events, profile, preserve };
}

test('restores legacy runtime name before acquiring the lock and opening profile paths', () => {
  const value = fixture();
  assert.equal(prepareDesktopProfile(value.app, {}, { preserve: value.preserve }), true);
  assert.deepEqual(value.events, ['name:gnosi', 'lock', 'userData', 'sessionData', { directory: value.profile, configured: [] }]);
  assert.equal(value.app.getName(), 'gnosi');
});

test('retains an explicit existing application identity', () => {
  const value = fixture({ name: 'Gnosi' });
  prepareDesktopProfile(value.app, {}, { preserve: value.preserve });
  assert.equal(value.app.getName(), 'Gnosi');
  assert.equal(value.events[0], 'lock');
});

test('must run before ready and does not acquire a late lock', () => {
  const value = fixture({ ready: true });
  assert.throws(() => prepareDesktopProfile(value.app, {}, { preserve: value.preserve }), /before Electron is ready/);
  assert.deepEqual(value.events, []);
});

test('a second instance cannot inspect or move profile data', () => {
  const value = fixture({ lock: false });
  assert.equal(prepareDesktopProfile(value.app, {}, { preserve: value.preserve }), false);
  assert.deepEqual(value.events, ['name:gnosi', 'lock']);
});

test('checks distinct sessionData without changing either path', () => {
  const value = fixture({ separateSession: true });
  prepareDesktopProfile(value.app, {}, { preserve: value.preserve });
  assert.deepEqual(value.events.slice(-2), [
    { directory: value.profile, configured: [] },
    { directory: `${value.profile}-session`, configured: [] },
  ]);
});

test('resolves all explicit data aliases relative to the actual backend directory', () => {
  const value = fixture();
  const backendCwd = path.resolve('/fixture/backend');
  const home = path.resolve('/fixture/home');
  const environment = Object.freeze({ GNOSI_DATA_DIR: '../canonical', GNOSI_LOCAL_DATA: '~/legacy', LOCAL_DATA_DIR: '~' });
  prepareDesktopProfile(value.app, environment, { preserve: value.preserve, backendCwd, home });
  assert.deepEqual(value.events.at(-1), {
    directory: value.profile,
    configured: [path.resolve(backendCwd, '../canonical'), path.join(home, 'legacy'), home],
  });
  assert.equal(environment.LOCAL_DATA_DIR, '~');
});

test('ambiguous named-user home paths fail before preservation', () => {
  const value = fixture();
  assert.throws(() => prepareDesktopProfile(value.app, { LOCAL_DATA_DIR: '~other/data' }, { preserve: value.preserve }), /absolute GNOSI_DATA_DIR/);
  assert.deepEqual(value.events, ['name:gnosi', 'lock']);
});

test('preservation failure propagates and prevents opening another session profile', () => {
  const value = fixture({ separateSession: true });
  const visited = [];
  assert.throws(() => prepareDesktopProfile(value.app, {}, { preserve: directory => {
    visited.push(directory);
    throw new Error('fixture preservation failure');
  } }), /fixture preservation failure/);
  assert.deepEqual(visited, [value.profile]);
});

test('actual main registers startup only after successful pre-ready protection', () => {
  let prepared = false;
  const runtime = loadMainRuntime({ prepareProfile: () => { prepared = true; return true; } });
  assert.equal(prepared, true);
  assert.equal(runtime.readyCallbacks.length, 1);
  assert.deepEqual(runtime.exits, []);
});

test('actual main exits before scheduling backend or windows on a protection error', () => {
  const runtime = loadMainRuntime({ prepareProfile: () => { throw new Error('fixture conflict'); } });
  assert.deepEqual(runtime.exits, [1]);
  assert.equal(runtime.readyCallbacks.length, 0);
  assert.equal(runtime.windows.length, 0);
  assert.deepEqual(runtime.calls, [{ errorBox: { title: 'Gnosi — profile protection', message: 'fixture conflict' } }]);
  runtime.lifecycle.get('activate')();
  runtime.lifecycle.get('second-instance')();
  assert.equal(runtime.windows.length, 0);
});

test('actual main exits quietly when another instance owns the profile', () => {
  const runtime = loadMainRuntime({ prepareProfile: () => false });
  assert.deepEqual(runtime.exits, [0]);
  assert.equal(runtime.readyCallbacks.length, 0);
  assert.deepEqual(runtime.calls, []);
  runtime.lifecycle.get('activate')();
  assert.equal(runtime.windows.length, 0);
});

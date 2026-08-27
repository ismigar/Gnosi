const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  getPackagedBackendEnvironment,
  getPackagedBackendExecutable,
} = require('./backend-launch');

test('macOS and Linux use the bundled PyInstaller executable directly', () => {
  assert.equal(
    getPackagedBackendExecutable('/app/resources', 'darwin'),
    path.join('/app/resources', 'python', 'cervell_backend'),
  );
  assert.equal(
    getPackagedBackendExecutable('/app/resources', 'linux'),
    path.join('/app/resources', 'python', 'cervell_backend'),
  );
});

test('Windows uses the bundled executable suffix', () => {
  assert.equal(
    getPackagedBackendExecutable('C:\\app\\resources', 'win32'),
    path.join('C:\\app\\resources', 'python', 'cervell_backend.exe'),
  );
});

test('packaged backends use a writable per-user data directory', () => {
  const environment = getPackagedBackendEnvironment(
    { PATH: '/usr/bin' },
    '/Users/example/Library/Application Support/Gnosi',
    5002,
  );

  assert.equal(
    environment.GNOSI_DATA_DIR,
    '/Users/example/Library/Application Support/Gnosi',
  );
  assert.equal(environment.GNOSI_LOCAL_DATA, environment.GNOSI_DATA_DIR);
  assert.equal(environment.BACKEND_PORT, '5002');
  assert.equal(environment.LOGGING_LEVEL, 'info');
  assert.equal(environment.PATH, '/usr/bin');
});

test('the canonical data override wins over the compatibility alias', () => {
  const environment = getPackagedBackendEnvironment(
    { GNOSI_DATA_DIR: '/canonical/data', GNOSI_LOCAL_DATA: '/legacy/data' },
    '/ignored/user-data',
    5002,
  );

  assert.equal(environment.GNOSI_DATA_DIR, '/canonical/data');
  assert.equal(environment.GNOSI_LOCAL_DATA, '/legacy/data');
});

test('the 3.x compatibility alias still selects the packaged data directory', () => {
  const environment = getPackagedBackendEnvironment(
    { GNOSI_LOCAL_DATA: '/legacy/data' },
    '/ignored/user-data',
    5002,
  );

  assert.equal(environment.GNOSI_DATA_DIR, '/legacy/data');
  assert.equal(environment.GNOSI_LOCAL_DATA, '/legacy/data');
});

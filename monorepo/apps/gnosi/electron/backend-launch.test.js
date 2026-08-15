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
    environment.GNOSI_LOCAL_DATA,
    path.join('/Users/example/Library/Application Support/Gnosi', 'local_data'),
  );
  assert.equal(environment.BACKEND_PORT, '5002');
  assert.equal(environment.LOGGING_LEVEL, 'info');
  assert.equal(environment.PATH, '/usr/bin');
});

test('an explicit local-data override is preserved', () => {
  const environment = getPackagedBackendEnvironment(
    { GNOSI_LOCAL_DATA: '/custom/data' },
    '/ignored/user-data',
    5002,
  );

  assert.equal(environment.GNOSI_LOCAL_DATA, '/custom/data');
});

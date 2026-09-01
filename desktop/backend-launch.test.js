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

test('LOCAL_DATA_DIR selects data before the userData fallback', () => {
  const environment = getPackagedBackendEnvironment(
    { LOCAL_DATA_DIR: '/older/data' },
    '/ignored/user-data',
    5002,
  );

  assert.equal(environment.GNOSI_DATA_DIR, '/older/data');
  assert.equal(environment.GNOSI_LOCAL_DATA, '/older/data');
  assert.equal(environment.LOCAL_DATA_DIR, '/older/data');
});

const dataKeys = ['GNOSI_DATA_DIR', 'GNOSI_LOCAL_DATA', 'LOCAL_DATA_DIR'];
const configuredPaths = ['/canonical/data', '/compatibility/data', '/older/data'];
const valueStates = ['absent', 'undefined', 'empty', 'configured'];
// Explicit precedence oracle for every combination of nonempty overrides.
const expectedByPresence = {
  '000': '/default/user-data',
  '001': '/older/data',
  '010': '/compatibility/data',
  '011': '/compatibility/data',
  '100': '/canonical/data',
  '101': '/canonical/data',
  '110': '/canonical/data',
  '111': '/canonical/data',
};

for (const canonical of valueStates) {
  for (const compatibility of valueStates) {
    for (const legacy of valueStates) {
      test(`data precedence: canonical=${canonical}, compatibility=${compatibility}, legacy=${legacy}`, () => {
        const states = [canonical, compatibility, legacy];
        const baseEnvironment = {};
        states.forEach((state, index) => {
          if (state !== 'absent') {
            baseEnvironment[dataKeys[index]] = state === 'configured'
              ? configuredPaths[index]
              : state === 'empty' ? '' : undefined;
          }
        });
        const before = { ...baseEnvironment };
        Object.freeze(baseEnvironment);
        const presence = states.map((state) => state === 'configured' ? '1' : '0').join('');
        const expectedDirectory = expectedByPresence[presence];

        const environment = getPackagedBackendEnvironment(
          baseEnvironment,
          '/default/user-data',
          5002,
        );

        assert.deepEqual(environment, {
          ...before,
          GNOSI_DATA_DIR: expectedDirectory,
          GNOSI_LOCAL_DATA: compatibility === 'configured'
            ? '/compatibility/data' : expectedDirectory,
          BACKEND_PORT: '5002',
          LOGGING_LEVEL: 'info',
        });
        assert.notStrictEqual(environment, baseEnvironment);
        assert.deepEqual(baseEnvironment, before);
      });
    }
  }
}

test('inherited unrelated entries survive and each result is an independent copy', () => {
  const baseEnvironment = Object.freeze({
    LOCAL_DATA_DIR: '/older/data',
    PATH: '/custom/bin:/usr/bin',
    HOME: '/home/example',
    CUSTOM_EMPTY: '',
    CUSTOM_UNDEFINED: undefined,
    CUSTOM_ZERO: '0',
    BACKEND_PORT: '9999',
    LOGGING_LEVEL: 'debug',
  });
  const before = { ...baseEnvironment };
  const first = getPackagedBackendEnvironment(baseEnvironment, '/fallback', 5003);
  const second = getPackagedBackendEnvironment(baseEnvironment, '/fallback', 5003);

  assert.deepEqual(first, {
    ...before,
    GNOSI_DATA_DIR: '/older/data',
    GNOSI_LOCAL_DATA: '/older/data',
    BACKEND_PORT: '5003',
    LOGGING_LEVEL: 'info',
  });
  assert.deepEqual(second, first);
  assert.notStrictEqual(first, second);
  first.PATH = '/changed/bin';
  first.GNOSI_DATA_DIR = '/changed/data';
  delete first.LOCAL_DATA_DIR;
  assert.equal(second.PATH, before.PATH);
  assert.equal(second.GNOSI_DATA_DIR, '/older/data');
  assert.equal(second.LOCAL_DATA_DIR, '/older/data');
  assert.deepEqual(baseEnvironment, before);
});

const stringPaths = [
  ['POSIX with spaces and Unicode', '/Users/Example/Library/Application Support/Gnosi/à'],
  ['Windows drive', String.raw`C:\Users\Example\AppData\Roaming\Gnosi Data`],
  ['Windows UNC', String.raw`\\server\shared data\Gnosi`],
  ['relative', '../Gnosi Data/./nested/../data'],
  ['unexpanded home', '~/Gnosi Data'],
  ['whitespace only', '   '],
];

for (const [description, dataPath] of stringPaths) {
  for (const source of [...dataKeys, 'userData']) {
    test(`${source} preserves a ${description} path string unchanged`, () => {
      const baseEnvironment = Object.freeze(source === 'userData' ? {} : { [source]: dataPath });
      const environment = getPackagedBackendEnvironment(
        baseEnvironment,
        source === 'userData' ? dataPath : '/ignored/fallback',
        5002,
      );

      assert.equal(environment.GNOSI_DATA_DIR, dataPath);
      assert.equal(environment.GNOSI_LOCAL_DATA, dataPath);
      assert.equal(environment.LOCAL_DATA_DIR, baseEnvironment.LOCAL_DATA_DIR);
    });
  }
}

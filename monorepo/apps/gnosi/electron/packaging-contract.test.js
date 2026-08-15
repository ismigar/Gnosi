const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  REQUIRED_RUNTIME_FILES,
  assertPackagedRuntimeEntries,
  getResourcesDirectory,
} = require('./scripts/packaging-contract.cjs');

const electronRoot = __dirname;

function localRuntimeRequires(source) {
  const requiredFiles = new Set();
  const localRequire = /require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(localRequire)) {
    const requestedPath = match[1].replaceAll('\\', '/');
    requiredFiles.add(path.posix.extname(requestedPath) ? requestedPath : `${requestedPath}.js`);
  }
  return [...requiredFiles].sort();
}

function configuredFiles(source) {
  const filesBlock = source.match(/^files:\n((?:  - .*\n)+)/m);
  assert.ok(filesBlock, 'electron-builder.yml must define a files block');
  return filesBlock[1]
    .split('\n')
    .map((line) => line.match(/^  - ([^#]+?)(?:\s+#.*)?$/)?.[1].trim())
    .filter(Boolean);
}

test('electron-builder packages every required runtime file', () => {
  const builderConfig = fs.readFileSync(path.join(electronRoot, 'electron-builder.yml'), 'utf8');
  const packagedFiles = configuredFiles(builderConfig);

  for (const runtimeFile of REQUIRED_RUNTIME_FILES) {
    assert.ok(packagedFiles.includes(runtimeFile), `${runtimeFile} must be packaged`);
  }
});

test('the runtime contract covers every local main-process require', () => {
  const mainSource = fs.readFileSync(path.join(electronRoot, 'main.js'), 'utf8');

  for (const runtimeFile of localRuntimeRequires(mainSource)) {
    assert.ok(
      REQUIRED_RUNTIME_FILES.includes(runtimeFile),
      `${runtimeFile} must be part of the packaged runtime contract`,
    );
  }
});

test('the packaged archive check rejects a missing runtime module', () => {
  assert.throws(
    () => assertPackagedRuntimeEntries([
      '/main.js',
      '/preload.js',
      '/update-policy.js',
    ]),
    /application-menu\.js/,
  );
});

test('the packaged archive check accepts normalized Windows entries', () => {
  assert.doesNotThrow(() => assertPackagedRuntimeEntries([
    '\\main.js',
    '\\preload.js',
    '\\application-menu.js',
    '\\backend-launch.js',
    '\\update-policy.js',
  ]));
});

test('the resources directory follows each platform layout', () => {
  assert.equal(
    getResourcesDirectory({
      appOutDir: '/tmp/mac-arm64',
      electronPlatformName: 'darwin',
      packager: { appInfo: { productFilename: 'Gnosi' } },
    }),
    path.join('/tmp/mac-arm64', 'Gnosi.app', 'Contents', 'Resources'),
  );
  assert.equal(
    getResourcesDirectory({
      appOutDir: '/tmp/win-unpacked',
      electronPlatformName: 'win32',
    }),
    path.join('/tmp/win-unpacked', 'resources'),
  );
});

test('the frozen backend keeps required standard-library and media modules', () => {
  const buildScript = fs.readFileSync(path.join(__dirname, 'build-python.sh'), 'utf8');

  assert.match(buildScript, /requirements-e2e\.txt/);
  assert.doesNotMatch(buildScript, /excludes=\[[^\]]*['"]unittest['"]/s);
  assert.doesNotMatch(buildScript, /excludes=\[[^\]]*['"]PIL['"]/s);
});

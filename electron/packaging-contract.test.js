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
const releaseWorkflowPath = path.resolve(
  electronRoot,
  '../../../..',
  '.github/workflows/build-release.yml',
);
const gnosiRoot = path.dirname(electronRoot);

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
  const runtimeRequirements = fs.readFileSync(path.join(gnosiRoot, 'requirements-e2e.txt'), 'utf8');

  assert.match(buildScript, /requirements-e2e\.txt/);
  assert.match(buildScript, /GNOSI_PYTHON_CMD/);
  assert.match(buildScript, /requested Python command not found/);
  assert.match(buildScript, /--only-binary=cryptography/);
  assert.match(buildScript, /mktemp -d .*gnosi-python-venv\.XXXXXX/);
  assert.doesNotMatch(buildScript, /VENV_DIR="\$ELECTRON_DIR\/\.venv-python"/);
  assert.doesNotMatch(buildScript, /excludes=\[[^\]]*['"]unittest['"]/s);
  assert.doesNotMatch(buildScript, /excludes=\[[^\]]*['"]PIL['"]/s);
  assert.match(runtimeRequirements, /^defusedxml>=0\.7\.1$/m);
});

test('the Docker backend installs CPU-only Torch before runtime requirements', () => {
  const dockerfile = fs.readFileSync(path.join(gnosiRoot, 'Dockerfile.backend'), 'utf8');
  const cpuTorchInstall = dockerfile.indexOf('https://download.pytorch.org/whl/cpu');
  const runtimeInstall = dockerfile.indexOf('pip install --no-cache-dir -r requirements.txt');

  assert.notEqual(cpuTorchInstall, -1);
  assert.notEqual(runtimeInstall, -1);
  assert.ok(cpuTorchInstall < runtimeInstall);
  assert.match(dockerfile, /torch==\$\{TORCH_VERSION\}\+cpu/);
});

test('macOS Intel uses the final cryptography universal2 wheel release', () => {
  for (const requirementsFile of ['requirements.txt', 'requirements-e2e.txt']) {
    const requirements = fs.readFileSync(path.join(gnosiRoot, requirementsFile), 'utf8');
    assert.match(
      requirements,
      /cryptography>=48\.0\.1,<49\.0\.0; sys_platform == "darwin" and platform_machine == "x86_64"/,
      `${requirementsFile} must retain the macOS Intel wheel constraint`,
    );
    assert.match(
      requirements,
      /cryptography>=[45]\d\.0\.0; sys_platform != "darwin" or platform_machine != "x86_64"/,
      `${requirementsFile} must retain current cryptography elsewhere`,
    );
  }
});

test('macOS release jobs match each frozen backend to its target architecture', () => {
  const workflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
  const builderConfig = fs.readFileSync(path.join(electronRoot, 'electron-builder.yml'), 'utf8');
  const macConfig = builderConfig.match(/^mac:\n([\s\S]*?)^linux:/m)?.[1];

  assert.doesNotMatch(workflow, /^\s+runs-on: macos-latest$/m);
  assert.match(workflow, /- arch: arm64\n\s+local_runner: \[self-hosted, macOS, ARM64\]/);
  assert.match(workflow, /- arch: x64\n\s+local_runner: \[self-hosted, macOS, X64\]/);
  assert.match(workflow, /runs-on: \$\{\{ matrix\.local_runner \}\}/);
  assert.doesNotMatch(workflow, /local_only:/);
  assert.match(workflow, /npm run build:mac -- --\$\{\{ matrix\.arch \}\}/);
  assert.match(workflow, /name: build-macos-\$\{\{ matrix\.arch \}\}/);
  assert.equal(
    workflow.match(/GNOSI_PYTHON_CMD: python/g)?.length,
    3,
    'every platform must use the Python provisioned by its setup action',
  );

  const macJob = workflow.match(/  build-macos:\n([\s\S]*?)\n  build-linux:/)?.[1];
  assert.ok(macJob, 'the release workflow must define a macOS build job');
  assert.doesNotMatch(macJob, /\.\/build-python\.sh/);
  assert.ok(macConfig, 'electron-builder.yml must define a macOS build block');
  assert.doesNotMatch(
    macConfig,
    /^\s+arch:/m,
    'the builder config must not override the release matrix target architecture',
  );
});

test('Linux release matches the frozen backend to the ARM64 runner', () => {
  const workflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
  const builderConfig = fs.readFileSync(path.join(electronRoot, 'electron-builder.yml'), 'utf8');
  const linuxConfig = builderConfig.match(/^linux:\n([\s\S]*?)^win:/m)?.[1];
  const linuxJob = workflow.match(/  build-linux:\n([\s\S]*?)\n  build-windows:/)?.[1];

  assert.ok(linuxJob, 'the release workflow must define a Linux build job');
  assert.match(linuxJob, /runs-on: \[self-hosted, Linux, ARM64\]/);
  assert.match(linuxJob, /npx electron-builder --linux --arm64 --publish never/);
  assert.doesNotMatch(linuxJob, /npm run build:linux/);
  assert.ok(linuxConfig, 'electron-builder.yml must define a Linux build block');
  assert.doesNotMatch(
    linuxConfig,
    /^\s+arch:/m,
    'the builder config must not force x64 around a host-native ARM64 Python backend',
  );
});

test('manual releases package the workflow commit and provision Windows Git before checkout', () => {
  const workflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
  const checkoutRefs = workflow.match(/ref: \$\{\{ github\.sha \}\}/g) ?? [];
  const windowsJob = workflow.match(/  build-windows:\n([\s\S]*?)\n  release:/)?.[1];

  assert.equal(
    checkoutRefs.length,
    5,
    'every release checkout must package the workflow commit instead of an older input tag',
  );
  assert.doesNotMatch(
    workflow,
    /ref: \$\{\{ github\.event_name == 'workflow_dispatch' && inputs\.tag \|\| github\.ref \}\}/,
  );
  assert.ok(windowsJob, 'the release workflow must define a Windows build job');
  assert.match(
    windowsJob,
    /defaults:\n\s+run:\n\s+shell: powershell -NoProfile -ExecutionPolicy Bypass -File \{0\}/,
  );
  assert.doesNotMatch(windowsJob, /^\s+shell: powershell$/m);
  assert.doesNotMatch(
    windowsJob,
    /Set-ExecutionPolicy\s+-Scope\s+LocalMachine/i,
    'release steps must not mutate machine-wide PowerShell policy',
  );
  assert.match(windowsJob, /- name: Ensure Git is available[\s\S]*?- name: Checkout/);
  assert.match(windowsJob, /Git\\cmd/);
});

test('the final release job provisions Node before rendering public notes', () => {
  const workflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
  const releaseJob = workflow.match(/  release:\n([\s\S]*)$/)?.[1];

  assert.ok(releaseJob, 'the release workflow must define a final release job');
  assert.match(
    releaseJob,
    /uses: actions\/setup-node@v7[\s\S]*?node-version: '22\.22\.2'[\s\S]*?- name: Render public release notes/,
  );
});

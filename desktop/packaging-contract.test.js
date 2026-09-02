const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
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
  '..',
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

test('the runtime contract covers transitive local main-process requires', () => {
  for (const sourceFile of REQUIRED_RUNTIME_FILES) {
    const source = fs.readFileSync(path.join(electronRoot, sourceFile), 'utf8');
    for (const runtimeFile of localRuntimeRequires(source)) {
      assert.ok(
        REQUIRED_RUNTIME_FILES.includes(runtimeFile),
        `${sourceFile} requires ${runtimeFile}, which must be in the packaged runtime contract`,
      );
    }
  }
});

test('the native no-replace adapter uses pinned prebuilt modules outside ASAR', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package.json'), 'utf8'));
  const builderConfig = fs.readFileSync(path.join(electronRoot, 'electron-builder.yml'), 'utf8');
  const workspace = fs.readFileSync(path.join(gnosiRoot, 'pnpm-workspace.yaml'), 'utf8');
  assert.equal(manifest.dependencies.koffi, '3.1.6');
  assert.match(builderConfig, /asarUnpack:\n  - node_modules\/koffi\/\*\*\/\*\n  - node_modules\/@koromix\/\*\*\/\*/);
  assert.match(workspace, /koffi: false/);
});

test('Electron43 tooling stays pinned and binary installation is explicit', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package.json'), 'utf8'));
  const workspace = fs.readFileSync(path.join(gnosiRoot, 'pnpm-workspace.yaml'), 'utf8');
  assert.equal(manifest.devDependencies.electron, '43.4.1');
  assert.equal(manifest.devDependencies['electron-builder'], '26.15.3');
  assert.equal(manifest.devDependencies['@electron/asar'], '4.3.0');
  assert.equal(manifest.scripts['install:runtime'], 'install-electron');
  assert.match(workspace, /electron: false/);
  assert.match(workspace, /electron-winstaller: false/);
  assert.doesNotMatch(workspace, /set this to true or false/);
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
    '\\ipc-security.js',
    '\\ipc-handlers.js',
    '\\backend-process.js',
    '\\startup-errors.js',
    '\\profile-startup.js',
    '\\cookie-schema-guard.js',
    '\\cookie-schema.js',
    '\\cookie-profile-migration.js',
    '\\cookie-migration.js',
    '\\cookie-migration-files.js',
    '\\cookie-rollback.js',
    '\\profile-preservation.js',
    '\\exclusive-rename.js',
    '\\application-menu.js',
    '\\backend-launch.js',
    '\\release-version.js',
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
  const resourcePolicy = fs.readFileSync(path.join(__dirname, 'scripts/backend_resources.py'), 'utf8');
  const pyproject = fs.readFileSync(path.join(gnosiRoot, 'pyproject.toml'), 'utf8');

  assert.match(buildScript, /uv sync/);
  assert.match(buildScript, /--frozen/);
  assert.match(buildScript, /--group desktop/);
  assert.match(buildScript, /GNOSI_PYTHON_CMD/);
  assert.match(buildScript, /requested Python command not found/);
  assert.match(buildScript, /mktemp -d .*gnosi-python-venv\.XXXXXX/);
  assert.match(buildScript, /scripts\/probe-python-abi\.py/);
  assert.doesNotMatch(buildScript, /(?:uv )?pip install/);
  assert.doesNotMatch(buildScript, /uv export/);
  assert.doesNotMatch(buildScript, /VENV_DIR="\$ELECTRON_DIR\/\.venv-python"/);
  assert.match(buildScript, /"\$PYTHON_VENV" "\$RESOURCE_POLICY" spec/);
  assert.match(buildScript, /--repository "\$GNOSI_DIR" --output/);
  assert.match(resourcePolicy, /pathex=\[\{str\(repository\)!r\}\]/);
  assert.doesNotMatch(resourcePolicy, /excludes=\[[^\]]*['"]unittest['"]/s);
  assert.doesNotMatch(resourcePolicy, /excludes=\[[^\]]*['"]PIL['"]/s);
  assert.match(pyproject, /"defusedxml>=0\.7\.1"/);
  assert.match(
    pyproject,
    /numpy>=1\.26\.4,<2; sys_platform == 'darwin' and platform_machine == 'x86_64'/,
  );
  assert.match(
    pyproject,
    /transformers>=4\.41,<5; sys_platform == 'darwin' and platform_machine == 'x86_64'/,
  );
  assert.match(
    pyproject,
    /torch==2\.2\.2; sys_platform == 'darwin' and platform_machine == 'x86_64'/,
  );
  assert.match(
    pyproject,
    /torch==2\.13\.0; sys_platform != 'darwin' or platform_machine != 'x86_64'/,
  );
  assert.match(
    pyproject,
    /torch = \[\s*\{ index = "pytorch-cpu", marker = "sys_platform == 'linux'" \},\s*\]/,
  );
  assert.match(pyproject, /url = "https:\/\/download\.pytorch\.org\/whl\/cpu"/);
  assert.match(pyproject, /explicit = true/);
  const abiProbe = fs.readFileSync(
    path.join(__dirname, 'scripts/probe-python-abi.py'),
    'utf8',
  );
  assert.match(abiProbe, /transformers\.is_torch_available\(\)/);
  assert.match(abiProbe, /from sentence_transformers import SentenceTransformer/);
  assert.match(abiProbe, /torch\.__version__ != "2\.13\.0\+cpu"/);
  assert.match(abiProbe, /name\.startswith\(\("cuda-", "nvidia-"\)\)/);
  assert.doesNotMatch(abiProbe, /probe skipped/);
});

test('the Docker backend synchronizes the universal lock in one pass', () => {
  const dockerfile = fs.readFileSync(path.join(gnosiRoot, 'Dockerfile.backend'), 'utf8');
  assert.match(dockerfile, /PATH="\/app\/\.venv\/bin:\$PATH"/);
  assert.match(
    dockerfile,
    /uv sync --frozen --no-cache --no-default-groups --no-install-workspace/,
  );
  assert.doesNotMatch(dockerfile, /uv export|uv pip install/);
  assert.doesNotMatch(dockerfile, /TORCH_VERSION/);
});

test('the frozen Linux ARM64 runtime is CPU-only and fully lock-owned', () => {
  const lock = fs.readFileSync(path.join(gnosiRoot, 'uv.lock'), 'utf8');
  const cpuTorch = lock.match(
    /\[\[package\]\]\nname = "torch"\nversion = "2\.13\.0\+cpu"[\s\S]*?(?=\n\[\[package\]\]|$)/,
  )?.[0];

  assert.ok(cpuTorch, 'Linux CPU Torch must be present in uv.lock');
  assert.match(
    cpuTorch,
    /source = \{ registry = "https:\/\/download\.pytorch\.org\/whl\/cpu" \}/,
  );
  assert.match(cpuTorch, /"sys_platform == 'linux'"/);
  assert.match(cpuTorch, /manylinux[^"\n]*aarch64\.whl/);
  assert.doesNotMatch(lock, /^name = "(?:triton|nvidia-|cuda-)/m);
});

test('macOS Intel uses the final cryptography universal2 wheel release', () => {
  const pyproject = fs.readFileSync(path.join(gnosiRoot, 'pyproject.toml'), 'utf8');
  assert.match(
    pyproject,
    /cryptography>=48\.0\.1,<49\.0\.0; sys_platform == 'darwin' and platform_machine == 'x86_64'/,
  );
  assert.match(
    pyproject,
    /cryptography>=50\.0\.0; sys_platform != 'darwin' or platform_machine != 'x86_64'/,
  );
});

test('macOS release jobs match each frozen backend to its target architecture', () => {
  const workflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
  const builderConfig = fs.readFileSync(path.join(electronRoot, 'electron-builder.yml'), 'utf8');
  const macConfig = builderConfig.match(/^mac:\n([\s\S]*?)^linux:/m)?.[1];

  assert.doesNotMatch(workflow, /^\s+runs-on: macos-latest$/m);
  assert.match(workflow, /- arch: arm64\n\s+runner: macos-15/);
  assert.match(workflow, /- arch: x64\n\s+runner: macos-15-intel/);
  assert.match(workflow, /runs-on: \$\{\{ matrix\.runner \}\}/);
  assert.doesNotMatch(workflow, /local_only:/);
  assert.match(workflow, /pnpm --filter @gnosi\/desktop build:mac -- --\$\{\{ matrix\.arch \}\}/);
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

test('Linux and Windows releases use hosted architecture-matched runners', () => {
  const workflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
  const builderConfig = fs.readFileSync(path.join(electronRoot, 'electron-builder.yml'), 'utf8');
  const linuxConfig = builderConfig.match(/^linux:\n([\s\S]*?)^win:/m)?.[1];
  const linuxJob = workflow.match(/  build-linux:\n([\s\S]*?)\n  build-windows:/)?.[1];

  assert.ok(linuxJob, 'the release workflow must define a Linux build job');
  assert.match(linuxJob, /runs-on: ubuntu-24\.04-arm/);
  assert.match(workflow, /build-windows:[\s\S]*?runs-on: windows-2025/);
  assert.match(linuxJob, /pnpm --filter @gnosi\/desktop exec electron-builder --linux --arm64 --publish never/);
  assert.doesNotMatch(linuxJob, /npm run build:linux/);
  assert.ok(linuxConfig, 'electron-builder.yml must define a Linux build block');
  assert.doesNotMatch(
    linuxConfig,
    /^\s+arch:/m,
    'the builder config must not force x64 around a host-native ARM64 Python backend',
  );
});

test('Linux desktop identity is safe and stable for scoped workspace packages', () => {
  const builderConfig = fs.readFileSync(
    path.join(electronRoot, 'electron-builder.yml'),
    'utf8',
  );
  const desktopPackage = JSON.parse(
    fs.readFileSync(path.join(electronRoot, 'package.json'), 'utf8'),
  );
  const linuxConfig = builderConfig.match(/^linux:\n([\s\S]*?)^win:/m)?.[1];

  assert.ok(linuxConfig);
  assert.match(linuxConfig, /^  executableName: gnosi$/m);
  assert.match(linuxConfig, /^  syncDesktopName: true$/m);
  assert.equal(desktopPackage.desktopName, 'gnosi.desktop');
  assert.doesNotMatch(linuxConfig, /@gnosi\/desktop/);
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

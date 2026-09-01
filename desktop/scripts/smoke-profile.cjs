/** Exercise old-runtime -> target-runtime -> target-runtime with synthetic data. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Electron's package entry may download a runtime. Resolve only local metadata.
function installedRuntime() {
  try {
    const packageRoot = path.dirname(require.resolve('electron/package.json'));
    const pathFile = path.join(packageRoot, 'path.txt');
    const executable = fs.existsSync(pathFile) ? fs.readFileSync(pathFile, 'utf8').trim() : '';
    const override = process.env.ELECTRON_OVERRIDE_DIST_PATH;
    if (!executable && !override) throw new Error('Electron path.txt is missing or empty');
    const dist = path.resolve(override || path.join(packageRoot, 'dist'));
    const runtime = path.resolve(dist, executable || 'electron');
    const relative = path.relative(dist, runtime);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Electron path.txt must identify a file inside the runtime directory');
    }
    if (!fs.statSync(runtime).isFile()) throw new Error('Electron runtime is not a file');
    return runtime;
  } catch (cause) {
    throw new Error(
      'Installed Electron runtime unavailable. Run pnpm --filter @gnosi/desktop install:runtime explicitly, or provide absolute seed and target executable paths. No runtime was downloaded.',
      { cause },
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 3 || (args[2] !== undefined && args[2] !== '--asar') ||
      args.slice(0, 2).some(argument => argument.startsWith('-'))) {
    throw new Error('Unknown or extra arguments. Usage: node smoke-profile.cjs [seed-runtime [target-runtime [--asar]]]');
  }

  // Pass the old executable explicitly after upgrading the workspace dependency.
  // Do not even resolve the installed package when both paths are supplied.
  const currentRuntime = (!args[0] || !args[1]) ? installedRuntime() : undefined;
  const seedRuntime = args[0] || currentRuntime;
  const targetRuntime = args[1] || currentRuntime;
  for (const runtime of [seedRuntime, targetRuntime]) {
    assert.ok(path.isAbsolute(runtime) && fs.statSync(runtime).isFile(), 'Expected an absolute Electron executable path');
  }
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gnosi-profile-smoke-'));
  fs.writeFileSync(path.join(root, 'owned-fixture'), 'Gnosi synthetic profile smoke v1');
  const legacyApp = path.join(root, 'legacy-app');
  const currentApp = path.join(root, 'current-app');
  for (const [directory, name] of [[legacyApp, 'gnosi'], [currentApp, '@gnosi/desktop']]) {
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name, version: '2.0.6', main: path.join(__dirname, 'profile-probe.cjs') }));
  }
  const targetApp = args[2] === '--asar'
    ? await require('./profile-asar.cjs').createProfileAsar(root)
    : currentApp;
  const reports = [];
  for (const [stage, runtime, appDirectory] of [
    ['seed', seedRuntime, legacyApp], ['upgrade', targetRuntime, targetApp], ['repeat', targetRuntime, targetApp],
  ]) {
    const result = spawnSync(runtime, [appDirectory], {
      timeout: 45_000, encoding: 'utf8', maxBuffer: 1024 * 1024,
      env: { ...process.env, GNOSI_PROFILE_SMOKE_DIR: root, GNOSI_PROFILE_SMOKE_STAGE: stage },
    });
    if (result.error || result.status !== 0) {
      process.stderr.write(`Profile smoke failed at ${stage}; artifacts: ${root}\n${result.stderr || ''}\n`);
      throw result.error || new Error(`Electron ${stage} exited ${result.status} (${result.signal || 'no signal'})`);
    }
    const report = JSON.parse(fs.readFileSync(path.join(root, `${stage}.json`), 'utf8'));
    assert.equal(report.passed, true);
    reports.push(report);
    process.stdout.write(`${stage}: Electron ${report.electron}; profile, browser storage and opaque data verified\n`);
  }
  fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify({ passed: true, reports }, null, 2));
  process.stdout.write(`Profile smoke passed. Artifacts: ${root}\n`);
}

// Leave CLI rejections unhandled so Node exits unsuccessfully; VM tests await this.
main();

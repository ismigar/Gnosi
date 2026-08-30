/** Exercise old-runtime -> target-runtime -> target-runtime with synthetic data. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Pass the old executable explicitly after upgrading the workspace dependency.
const currentRuntime = require('electron');
const seedRuntime = process.argv[2] || currentRuntime;
const targetRuntime = process.argv[3] || currentRuntime;
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
const reports = [];
for (const [stage, runtime, appDirectory] of [
  ['seed', seedRuntime, legacyApp], ['upgrade', targetRuntime, currentApp], ['repeat', targetRuntime, currentApp],
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

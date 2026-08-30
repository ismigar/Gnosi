/** Run the isolated IPC/native-adapter fixture through a real ASAR boundary. */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createProfileAsar } = require('./profile-asar.cjs');

async function main() {
  const runtime = process.argv[2];
  assert.ok(process.argv.length === 3 && runtime && path.isAbsolute(runtime) && fs.statSync(runtime).isFile(),
    'Provide one absolute installed Electron executable; no runtime will be downloaded.');
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gnosi-profile-smoke-'));
  fs.writeFileSync(path.join(root, 'owned-fixture'), 'Gnosi synthetic profile smoke v1');
  const archive = await createProfileAsar(root, 'ipc');
  const result = spawnSync(runtime, [archive], {
    timeout: 45_000, encoding: 'utf8', maxBuffer: 1024 * 1024,
    env: process.env,
  });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.ok(!result.error && result.status === 0, `ASAR IPC probe failed; fixture: ${root}`);
  const line = result.stdout.split('\n').find(item => item.startsWith('{"electron":'));
  assert.ok(line, 'IPC probe must return its report');
  const report = JSON.parse(line);
  assert.equal(report.passed, true);
  assert.equal(report.nativeProfilePreserved, true);
  assert.equal(report.appPath, archive);
  process.stdout.write(`ASAR IPC/native-adapter smoke passed. Archive: ${archive}\n`);
}

main();

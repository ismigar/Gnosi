const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const asar = require('@electron/asar');
const { createProfileAsar } = require('./scripts/profile-asar.cjs');
const { REQUIRED_RUNTIME_FILES } = require('./scripts/packaging-contract.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-profile-smoke-'));
  t.after(() => {
    asar.uncacheAll();
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'owned-fixture'), 'Gnosi synthetic profile smoke v1');
  return root;
}

test('ASAR4 packages the isolated entry and identical production helpers', async t => {
  const root = fixture(t);
  const archive = await createProfileAsar(root);
  const manifest = JSON.parse(asar.extractFile(archive, 'package.json'));
  assert.equal(manifest.main, 'scripts/profile-probe.cjs');
  assert.equal(manifest.name, '@gnosi/desktop');
  for (const file of [...REQUIRED_RUNTIME_FILES, 'scripts/profile-probe.cjs']) {
    assert.deepEqual(asar.extractFile(archive, file), fs.readFileSync(path.join(__dirname, file)));
  }
  const entries = asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/').replace(/^\/+/, ''));
  const native = entries.filter(entry => entry.endsWith('.node'));
  assert.ok(native.length);
  for (const file of native) {
    assert.equal(asar.statFile(archive, file).unpacked, true);
    assert.ok(fs.statSync(path.join(`${archive}.unpacked`, file)).isFile());
  }
  assert.equal(asar.statFile(archive, 'node_modules/koffi/src/koffi/index.cjs').unpacked, true);
  assert.equal(Boolean(asar.statFile(archive, 'profile-startup.js').unpacked), false);
  assert.ok(!entries.some(entry => entry.includes('electron-updater')));
  await assert.rejects(createProfileAsar(root), /outputs must be new/);
});

test('ASAR fixture rejects unowned roots without creating outputs', async t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'owned-fixture'), 'different fixture');
  await assert.rejects(createProfileAsar(root));
  assert.equal(fs.existsSync(path.join(root, 'asar-source')), false);
});

test('ASAR fixture preserves existing output bytes', async t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'app.asar'), 'existing archive');
  await assert.rejects(createProfileAsar(root), /outputs must be new/);
  assert.equal(fs.readFileSync(path.join(root, 'app.asar'), 'utf8'), 'existing archive');
  assert.equal(fs.existsSync(path.join(root, 'asar-source')), false);
});

test('ASAR can select only the isolated IPC entry, never production main', async t => {
  const root = fixture(t);
  await assert.rejects(createProfileAsar(root, 'main.js'), /Only isolated probe/);
  assert.equal(fs.existsSync(path.join(root, 'asar-source')), false);
  const archive = await createProfileAsar(root, 'ipc');
  assert.equal(JSON.parse(asar.extractFile(archive, 'package.json')).main, 'scripts/smoke-ipc.cjs');
  assert.deepEqual(asar.extractFile(archive, 'scripts/smoke-ipc.cjs'), fs.readFileSync(path.join(__dirname, 'scripts/smoke-ipc.cjs')));
});

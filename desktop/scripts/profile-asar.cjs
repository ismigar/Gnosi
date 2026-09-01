/** Build an isolated profile probe, never the production application entry. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const { REQUIRED_RUNTIME_FILES, assertPackagedRuntimeEntries } = require('./packaging-contract.cjs');

async function createProfileAsar(root, probe = 'profile') {
  assert.ok(['profile', 'ipc'].includes(probe), 'Only isolated probe entries may run');
  assert.ok(path.isAbsolute(root) && path.basename(root).startsWith('gnosi-profile-smoke-'));
  assert.equal(fs.readFileSync(path.join(root, 'owned-fixture'), 'utf8'), 'Gnosi synthetic profile smoke v1');
  const source = path.join(root, 'asar-source');
  const archive = path.join(root, 'app.asar');
  for (const target of [source, archive, `${archive}.unpacked`]) {
    assert.equal(fs.existsSync(target), false, 'Fixture outputs must be new');
  }
  fs.mkdirSync(source);
  const desktop = path.resolve(__dirname, '..');
  for (const file of REQUIRED_RUNTIME_FILES) {
    fs.copyFileSync(path.join(desktop, file), path.join(source, file), fs.constants.COPYFILE_EXCL);
  }
  fs.mkdirSync(path.join(source, 'scripts'));
  for (const file of ['profile-probe.cjs', 'smoke-ipc.cjs']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(source, 'scripts', file));
  }
  fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
    name: '@gnosi/desktop', version: '2.0.6', main: probe === 'profile' ? 'scripts/profile-probe.cjs' : 'scripts/smoke-ipc.cjs',
  }), { flag: 'wx' });

  // Copy only the installed host prebuild; no source compilation or downloads.
  const koffiRoot = path.dirname(require.resolve('koffi'));
  const nativeName = `@koromix/koffi-${process.platform}-${process.arch}`;
  const nativeRoot = path.dirname(require.resolve(nativeName, { paths: [koffiRoot] }));
  for (const [name, directory] of [['koffi', koffiRoot], [nativeName, nativeRoot]]) {
    fs.cpSync(directory, path.join(source, 'node_modules', name), {
      recursive: true, dereference: true, errorOnExist: true, force: false,
    });
  }
  await asar.createPackageWithOptions(source, archive, {
    unpackDir: 'node_modules/{koffi,@koromix}',
  });
  const entries = asar.listPackage(archive).map(entry => entry.replaceAll('\\', '/').replace(/^\/+/, ''));
  assertPackagedRuntimeEntries(entries);
  const nativeEntries = entries.filter(entry => entry.endsWith('.node'));
  assert.ok(nativeEntries.length > 0, 'Host Node-API prebuild must be present');
  for (const entry of nativeEntries) {
    assert.equal(asar.statFile(archive, entry).unpacked, true, 'Native binaries must be outside ASAR');
    assert.ok(fs.statSync(path.join(`${archive}.unpacked`, entry)).isFile());
  }
  return archive;
}

module.exports = { createProfileAsar };

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildMacInstallerUrl, getUpdateInstallMode } = require('./update-policy');

test('macOS uses the manual installer flow until stable signing is configured', () => {
  assert.equal(getUpdateInstallMode('darwin'), 'manual');
  assert.equal(getUpdateInstallMode('win32'), 'automatic');
  assert.equal(getUpdateInstallMode('linux'), 'automatic');
});

test('builds the official architecture-specific macOS DMG URL', () => {
  assert.equal(
    buildMacInstallerUrl('1.2.0', 'arm64'),
    'https://github.com/ismigar/Gnosi/releases/download/v1.2.0/Gnosi-1.2.0-arm64.dmg',
  );
  assert.equal(
    buildMacInstallerUrl('1.2.0-rc.1', 'x64'),
    'https://github.com/ismigar/Gnosi/releases/download/v1.2.0-rc.1/Gnosi-1.2.0-rc.1-x64.dmg',
  );
});

test('rejects untrusted versions and unsupported macOS architectures', () => {
  assert.throws(() => buildMacInstallerUrl('../latest', 'arm64'), /invalid version/);
  assert.throws(() => buildMacInstallerUrl('1.2.0', 'ia32'), /Unsupported macOS architecture/);
});

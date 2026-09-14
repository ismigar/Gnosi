const assert = require('node:assert/strict');
const test = require('node:test');
const { findInstaller, offerInstallerCleanup } = require('./installer-cleanup');

const candidate = { source: '/Users/fixture/Downloads/Gnosi.dmg', mount: '/Volumes/Gnosi' };
const image = { 'image-path': candidate.source, 'system-entities': [{ 'mount-point': candidate.mount }] };

test('identification requires matching payload, a regular DMG and an unambiguous volume', () => {
  const filesystem = { lstatSync: () => ({ isFile: () => true }), existsSync: () => true,
    readFileSync: () => 'same app payload' };
  assert.deepEqual(findInstaller([image], '/Applications/Gnosi.app', filesystem), candidate);
  assert.equal(findInstaller([image, image], '/Applications/Gnosi.app', filesystem), null);
  assert.equal(findInstaller([{ ...image, 'image-path': '/Users/fixture/document.pdf' }], '/Applications/Gnosi.app', filesystem), null);
  assert.equal(findInstaller([image], '/Applications/Gnosi.app', { ...filesystem,
    readFileSync: file => file.startsWith('/Volumes/') ? 'another version' : 'installed version' }), null);
  assert.equal(findInstaller([image], '/Applications/Gnosi.app', { ...filesystem,
    lstatSync: () => ({ isFile: () => false }) }), null);
});

for (const response of [0, 1, 2]) {
  test(`native choice ${response} respects eject/trash/cancel and order`, async () => {
    const calls = [];
    await offerInstallerCleanup({ platform: 'darwin', isInstalled: true,
      installedApp: '/Applications/Gnosi.app', locale: 'ca-ES',
      getImages: async () => [image], identify: () => candidate,
      dialog: { showMessageBox: async options => {
        assert.equal(options.cancelId, 2);
        assert.ok(options.detail.includes(candidate.source));
        return { response };
      }, showErrorBox: () => assert.fail('Unexpected error') },
      detach: async mount => { calls.push(['eject', mount]); },
      shell: { trashItem: async source => { calls.push(['trash', source]); } },
    });
    assert.deepEqual(calls, response === 0 ? [['eject', candidate.mount], ['trash', candidate.source]]
      : response === 1 ? [['eject', candidate.mount]] : []);
  });
}

test('busy volumes are not forced or trashed; failures are shown', async () => {
  let errors = 0;
  await offerInstallerCleanup({ platform: 'darwin', isInstalled: true, locale: 'en',
    getImages: async () => [image], identify: () => candidate,
    dialog: { showMessageBox: async () => ({ response: 0 }), showErrorBox: () => { errors++; } },
    detach: async () => { throw new Error('Resource busy'); },
    shell: { trashItem: () => assert.fail('Must not trash while mounted') },
  });
  assert.equal(errors, 1);
});

test('running from a disk image and non-macOS never inspect or eject images', async () => {
  for (const options of [{ platform: 'darwin', isInstalled: false }, { platform: 'linux', isInstalled: true }]) {
    await offerInstallerCleanup({ ...options, getImages: () => assert.fail('Not applicable') });
  }
});

test('changed identity after confirmation prevents cleanup', async () => {
  let reads = 0;
  await offerInstallerCleanup({ platform: 'darwin', isInstalled: true, locale: 'en',
    getImages: async () => [image], identify: () => ++reads === 1 ? candidate : null,
    dialog: { showMessageBox: async () => ({ response: 0 }) },
    detach: () => assert.fail('Identity changed'), shell: {},
  });
});

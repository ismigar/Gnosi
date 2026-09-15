const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveVaultFolder } = require('./vault-folders');
const { launchConfiguredBackend } = require('./vault-startup');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-container-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const container = path.join(root, 'Gnosi');
  fs.mkdirSync(container);
  return { root, container };
}

test('existing child vaults win over accidentally scaffolded container', t => {
  const { container } = fixture(t);
  for (const name of ['Principal', 'Proves', 'Marketplace Smoke Test', '']) {
    fs.mkdirSync(path.join(container, name, '.gnosi'), { recursive: true });
  }
  fs.mkdirSync(path.join(container, 'Assets'));
  assert.deepEqual(resolveVaultFolder(container), { root: container, vault: path.join(container, 'Principal') });
  assert.deepEqual(resolveVaultFolder(path.join(container, 'Proves')), { root: container, vault: path.join(container, 'Proves') });
});

test('empty container selects Principal without creating it during discovery', t => {
  const { container } = fixture(t);
  assert.equal(resolveVaultFolder(container).vault, path.join(container, 'Principal'));
  assert.deepEqual(fs.readdirSync(container), []);
});

test('legacy stored container migrates before backend startup and resets selection once', async t => {
  const { root, container } = fixture(t);
  fs.mkdirSync(path.join(container, 'Principal', '.gnosi'), { recursive: true });
  const data = path.join(root, 'data');
  fs.mkdirSync(data);
  const file = path.join(data, 'desktop-vault.json');
  const oldId = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(file, JSON.stringify({ path: container, selectionId: oldId }));
  const options = { environment: { GNOSI_DATA_DIR: data }, locale: 'en',
    chooseDirectory: async () => assert.fail('Migration must not prompt'),
    launch: async env => {
      assert.equal(env.DIGITAL_BRAIN_VAULT_PATH, path.join(container, 'Principal'));
      assert.equal(env.GNOSI_VAULTS_ROOT, container);
      assert.equal(env.GNOSI_DESKTOP_VAULT_DISCOVERY, '1');
      return { vaultConfigured: true, stop: async () => {} };
    } };
  const first = await launchConfiguredBackend(options);
  assert.notEqual(first.vaultSelectionId, oldId);
  const second = await launchConfiguredBackend(options);
  assert.equal(second.vaultSelectionId, first.vaultSelectionId);
  assert.equal(JSON.parse(fs.readFileSync(file)).root, container);
});

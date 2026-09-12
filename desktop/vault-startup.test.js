const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchConfiguredBackend, vaultDialogOptions } = require('./vault-startup');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-vault-setup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const vault = path.join(root, 'existing-vault');
  fs.mkdirSync(vault);
  fs.writeFileSync(path.join(vault, 'note.md'), 'Existing knowledge');
  return { root, vault, environment: { GNOSI_DATA_DIR: path.join(root, 'data') } };
}

function handle(configured, calls, name) {
  return { vaultConfigured: configured, stop: async () => calls.push(`stop:${name}`) };
}

test('missing configuration selects a folder, reaps the first child, and persists only after readiness', async t => {
  const { vault, environment } = fixture(t);
  const calls = [];
  const first = handle(false, calls, 'first');
  const configured = handle(true, calls, 'second');
  const selectionFile = path.join(environment.GNOSI_DATA_DIR, 'desktop-vault.json');
  const result = await launchConfiguredBackend({ environment, locale: 'ca-ES',
    launch: async env => {
      calls.push('launch');
      assert.equal(fs.existsSync(selectionFile), false);
      if (calls.length === 1) return first;
      assert.equal(env.DIGITAL_BRAIN_VAULT_PATH, vault);
      return configured;
    },
    chooseDirectory: async options => {
      calls.push('choose');
      assert.equal(options.title, 'Tria la biblioteca de Gnosi');
      return { canceled: false, filePaths: [vault] };
    },
  });
  assert.equal(result, configured);
  assert.deepEqual(calls, ['launch', 'stop:first', 'choose', 'launch']);
  const saved = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
  assert.equal(saved.path, vault);
  assert.match(saved.selectionId, /^[0-9a-f-]{36}$/);
  assert.equal(result.vaultSelectionId, saved.selectionId);
  assert.equal(fs.readFileSync(path.join(vault, 'note.md'), 'utf8'), 'Existing knowledge');
  assert.equal(environment.DIGITAL_BRAIN_VAULT_PATH, undefined);

  const reopened = await launchConfiguredBackend({ environment, locale: 'ca',
    launch: async env => { assert.equal(env.DIGITAL_BRAIN_VAULT_PATH, vault); return configured; },
    chooseDirectory: async () => assert.fail('A saved available Vault must not prompt again'),
  });
  assert.equal(reopened, configured);
  assert.equal(reopened.vaultSelectionId, saved.selectionId);
});

test('existing configuration and explicit environment remain authoritative', async t => {
  const { vault, environment } = fixture(t);
  fs.mkdirSync(environment.GNOSI_DATA_DIR);
  fs.writeFileSync(path.join(environment.GNOSI_DATA_DIR, 'desktop-vault.json'), JSON.stringify({ path: vault }));
  for (const key of ['DIGITAL_BRAIN_VAULT_PATH', 'VAULT_HOST_PATH']) {
    const explicit = { ...environment, [key]: '/explicit/vault' };
    await launchConfiguredBackend({ environment: explicit, locale: 'en',
      launch: async env => { assert.deepEqual(env, explicit); return handle(true, [], 'ready'); },
      chooseDirectory: async () => assert.fail('Configured installs do not prompt'),
    });
  }
});

test('cancel leaves no selection and no live unconfigured child', async t => {
  const { environment } = fixture(t);
  const calls = [];
  const result = await launchConfiguredBackend({ environment, locale: 'en',
    launch: async () => handle(false, calls, 'first'),
    chooseDirectory: async () => ({ canceled: true, filePaths: [] }),
  });
  assert.equal(result, null);
  assert.deepEqual(calls, ['stop:first']);
  assert.equal(fs.existsSync(environment.GNOSI_DATA_DIR), false);
});

test('a failed restart does not persist the new selection', async t => {
  const { vault, environment } = fixture(t);
  const calls = [];
  let count = 0;
  await assert.rejects(launchConfiguredBackend({ environment, locale: 'en',
    launch: async () => handle(false, calls, String(++count)),
    chooseDirectory: async () => ({ canceled: false, filePaths: [vault] }),
  }), /could not be configured/);
  assert.deepEqual(calls, ['stop:1', 'stop:2']);
  assert.equal(fs.existsSync(environment.GNOSI_DATA_DIR), false);
});

test('an unavailable saved volume is never recreated and can be selected again', async t => {
  const { root, vault, environment } = fixture(t);
  const missing = path.join(root, 'unmounted', 'vault');
  fs.mkdirSync(environment.GNOSI_DATA_DIR);
  fs.writeFileSync(path.join(environment.GNOSI_DATA_DIR, 'desktop-vault.json'), JSON.stringify({ path: missing }));
  let count = 0;
  await launchConfiguredBackend({ environment, locale: 'en',
    launch: async env => {
      count++;
      assert.equal(env.DIGITAL_BRAIN_VAULT_PATH, count === 1 ? undefined : vault);
      return handle(count === 2, [], String(count));
    },
    chooseDirectory: async () => ({ canceled: false, filePaths: [vault] }),
  });
  assert.equal(fs.existsSync(missing), false);
});

test('quitting while the picker is open cannot launch another child or save', async t => {
  const { vault, environment } = fixture(t);
  let quitting = false;
  let launches = 0;
  const result = await launchConfiguredBackend({ environment, locale: 'en', isQuitting: () => quitting,
    launch: async () => { launches++; return handle(false, [], 'first'); },
    chooseDirectory: async () => { quitting = true; return { canceled: false, filePaths: [vault] }; },
  });
  assert.equal(result, null);
  assert.equal(launches, 1);
  assert.equal(fs.existsSync(environment.GNOSI_DATA_DIR), false);
});

for (const locale of ['en-US', 'ca_ES', 'es-ES', 'fr-FR', 'de-DE']) {
  test(`native initial folder selection has complete labels for ${locale}`, () => {
    const options = vaultDialogOptions(locale);
    assert.ok(options.title && options.message && options.buttonLabel);
    assert.deepEqual(options.properties, ['openDirectory', 'createDirectory']);
  });
}

test('relative data overrides resolve from the backend directory, not the launcher directory', async t => {
  const { root, vault } = fixture(t);
  fs.mkdirSync(path.join(root, 'data'));
  fs.writeFileSync(path.join(root, 'data', 'desktop-vault.json'), JSON.stringify({ path: vault }));
  await launchConfiguredBackend({ environment: { GNOSI_DATA_DIR: 'data' }, backendCwd: root, locale: 'en',
    launch: async env => {
      assert.equal(env.DIGITAL_BRAIN_VAULT_PATH, vault);
      assert.equal(env.GNOSI_DATA_DIR, 'data');
      return handle(true, [], 'ready');
    },
    chooseDirectory: async () => assert.fail('The backend-relative selection must be reused'),
  });
});

test('recovering a moved library replaces the selection marker once and never recreates its old path', async t => {
  const { root, vault, environment } = fixture(t);
  const launch = async env => handle(Boolean(env.DIGITAL_BRAIN_VAULT_PATH), [], 'backend');
  const initial = await launchConfiguredBackend({ environment, locale: 'en', launch,
    chooseDirectory: async () => ({ canceled: false, filePaths: [vault] }),
  });
  const relocated = path.join(root, 'relocated-vault');
  fs.renameSync(vault, relocated);
  const recovered = await launchConfiguredBackend({ environment, locale: 'en', launch,
    chooseDirectory: async () => ({ canceled: false, filePaths: [relocated] }),
  });
  assert.notEqual(recovered.vaultSelectionId, initial.vaultSelectionId);
  assert.equal(fs.existsSync(vault), false);
  assert.equal(fs.readFileSync(path.join(relocated, 'note.md'), 'utf8'), 'Existing knowledge');
  const reopened = await launchConfiguredBackend({ environment, locale: 'en', launch,
    chooseDirectory: async () => assert.fail('The recovered selection must survive reopening'),
  });
  assert.equal(reopened.vaultSelectionId, recovered.vaultSelectionId);
  assert.equal(fs.existsSync(vault), false);
});

test('canceling recovery preserves the prior selection marker and does not create a directory', async t => {
  const { root, vault, environment } = fixture(t);
  const initial = await launchConfiguredBackend({ environment, locale: 'en',
    launch: async env => handle(Boolean(env.DIGITAL_BRAIN_VAULT_PATH), [], 'backend'),
    chooseDirectory: async () => ({ canceled: false, filePaths: [vault] }),
  });
  const selectionFile = path.join(environment.GNOSI_DATA_DIR, 'desktop-vault.json');
  const before = fs.readFileSync(selectionFile, 'utf8');
  fs.renameSync(vault, path.join(root, 'relocated'));
  const canceled = await launchConfiguredBackend({ environment, locale: 'en',
    launch: async () => handle(false, [], 'backend'),
    chooseDirectory: async () => ({ canceled: true, filePaths: [] }),
  });
  assert.equal(canceled, null);
  assert.ok(initial.vaultSelectionId);
  assert.equal(fs.readFileSync(selectionFile, 'utf8'), before);
  assert.equal(fs.existsSync(vault), false);
});

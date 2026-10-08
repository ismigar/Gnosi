const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadMainRuntime, senderEvent } = require('./test-helpers/main-runtime.cjs');

const options = { mode: 'any', multiple: true, title: 'Selecciona un fitxer o carpeta',
  fileLabel: 'Fitxer', folderLabel: 'Carpeta', cancelLabel: 'Cancel·la' };
test('native picker attaches to the Gnosi window and preserves mixed multiple selections', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-native-picker-'));
  try {
    const file = path.join(root, 'report.pdf'); fs.writeFileSync(file, 'fixture');
    let seen;
    const runtime = loadMainRuntime({ showOpenDialog: async (owner, value) => {
      seen = { owner, value }; return { canceled: false, filePaths: [file, root] };
    } });
    const window = runtime.createWindow();
    const result = await runtime.handlers.get('pick-filesystem')(senderEvent(window), { ...options, initialPath: root });
    assert.equal(seen.owner, window);
    assert.equal(seen.value.defaultPath, root);
    assert.deepEqual(Array.from(seen.value.properties), ['openFile', 'openDirectory', 'multiSelections']);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { canceled: false, entries: [{ path: file, isDir: false }, { path: root, isDir: true }] });
  } finally { fs.rmSync(root, { recursive: true }); }
});
test('cancelling a native picker returns no selection', async () => {
  const runtime = loadMainRuntime(); const window = runtime.createWindow();
  const result = await runtime.handlers.get('pick-filesystem')(senderEvent(window), options);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { canceled: true, entries: [] });
});

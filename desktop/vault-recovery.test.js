const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const preload = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
const firstSelection = '11111111-1111-4111-8111-111111111111';
const recoveredSelection = '22222222-2222-4222-8222-222222222222';
const appliedKey = 'gnosi_desktop_vault_selection';

function browserState() {
  const values = new Map([
    ['gnosi_active_vault', 'original-id'], ['gnosi_active_vault_slug', 'original-slug'],
    ['gnosi_active_vault_name', 'My library'], ['gnosi_vault_catalog', 'cached-old-library'],
    ['neutral-effects', 'true'], ['editor-preferences', 'synthetic-preference'],
  ]);
  return { values, cookie: 'gnosi_active_vault=original-id; theme=neutral', cookieWrites: [] };
}

function runPreload(state, selectionId, protocol = 'app:') {
  const document = {
    get cookie() { return state.cookie; },
    set cookie(value) {
      state.cookieWrites.push(value);
      state.cookie = state.cookie.split('; ').filter(value => !value.startsWith('gnosi_active_vault=')).join('; ');
    },
  };
  const storage = {
    getItem: key => state.values.get(key) ?? null,
    setItem: (key, value) => state.values.set(key, value),
    removeItem: key => state.values.delete(key),
  };
  vm.runInNewContext(preload, {
    process: { argv: selectionId ? [`--gnosi-vault-selection=${selectionId}`] : [] },
    window: { location: { protocol, hostname: 'gnosi' }, localStorage: storage },
    document,
    require: name => {
      assert.equal(name, 'electron');
      return { ipcRenderer: new EventEmitter(), contextBridge: { exposeInMainWorld() {} } };
    },
  });
}

test('recovered folder clears the obsolete request identity before application code and preserves preferences', () => {
  const state = browserState();
  state.values.set(appliedKey, firstSelection);
  runPreload(state, recoveredSelection);
  for (const key of ['gnosi_active_vault', 'gnosi_active_vault_slug', 'gnosi_active_vault_name', 'gnosi_vault_catalog']) {
    assert.equal(state.values.has(key), false, key);
  }
  assert.equal(state.cookie, 'theme=neutral');
  assert.equal(state.values.get('neutral-effects'), 'true');
  assert.equal(state.values.get('editor-preferences'), 'synthetic-preference');
  assert.equal(state.values.get(appliedKey), recoveredSelection);
});

test('same-path upgrade keeps preferences and only applies explicit selection once', () => {
  const state = browserState();
  runPreload(state, firstSelection);
  state.values.set('gnosi_active_vault', 'original-id');
  state.values.set('gnosi_active_vault_slug', 'original-slug');
  state.cookie = 'gnosi_active_vault=original-id; theme=neutral';
  const expected = [...state.values];
  runPreload(state, firstSelection);
  assert.deepEqual([...state.values], expected);
  assert.equal(state.cookieWrites.length, 1);
  assert.equal(state.cookie, 'gnosi_active_vault=original-id; theme=neutral');
});

test('switching between two existing libraries survives new windows and restart without rewriting either identity', () => {
  const state = browserState();
  runPreload(state, firstSelection);
  state.values.set('gnosi_active_vault', 'second-id');
  state.values.set('gnosi_active_vault_slug', 'second-slug');
  state.values.set('gnosi_vault_catalog', JSON.stringify([{ id: 'original-id' }, { id: 'second-id' }]));
  state.cookie = 'gnosi_active_vault=second-id; theme=neutral';
  const expected = [...state.values];
  runPreload(state, firstSelection);
  runPreload(state, firstSelection);
  assert.deepEqual([...state.values], expected);
  assert.equal(state.cookie, 'gnosi_active_vault=second-id; theme=neutral');
  assert.equal(state.cookieWrites.length, 1);
});

for (const [label, selectionId, protocol] of [
  ['legacy same-path launch', undefined, 'app:'],
  ['development browser', firstSelection, 'http:'],
  ['malformed selection marker', 'invalid-selection', 'app:'],
]) {
  test(`${label} does not reset browser selection`, () => {
    const state = browserState();
    const expected = [...state.values];
    runPreload(state, selectionId, protocol);
    assert.deepEqual([...state.values], expected);
    assert.equal(state.cookieWrites.length, 0);
  });
}

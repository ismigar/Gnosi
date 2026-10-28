const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerRendererRecovery } = require('./renderer-recovery');

function fixture(locale = 'ca') {
  const window = new EventEmitter(); let destroyed = false; let quitting = false; let reloads = 0; const records = []; const dialogs = [];
  window.isDestroyed = () => destroyed;
  window.webContents = Object.assign(new EventEmitter(), { reload: () => { reloads++; } });
  let finish; const result = new Promise(resolve => { finish = resolve; });
  registerRendererRecovery({ window, locale, isQuitting: () => quitting, record: (reason, exitCode) => records.push({ reason, exitCode }), dialog: { showMessageBox: async (_window, options) => { dialogs.push(options); return result; } } });
  return { window, dialogs, records, get reloads() { return reloads; }, finish: response => finish({ response }), stop: reason => window.webContents.emit('render-process-gone', {}, { reason, exitCode: 5 }), close: () => { destroyed = true; window.emit('closed'); }, quit: () => { quitting = true; } };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('renderer exit offers one explicit reload without restarting the service', async () => {
  const f = fixture(); f.stop('oom'); f.stop('crashed');
  assert.equal(f.dialogs.length, 1); assert.equal(f.reloads, 0);
  assert.deepEqual(f.records[0], { reason: 'oom', exitCode: 5 });
  assert.deepEqual(f.dialogs[0].buttons, ['Reobre la pantalla', 'Ara no']);
  f.finish(0); await settle(); assert.equal(f.reloads, 1);
});

test('cancelling recovery never reloads; normal exit and shutdown never prompt', async () => {
  const f = fixture(); f.stop('clean-exit'); assert.equal(f.dialogs.length, 0);
  f.stop('crashed'); f.finish(1); await settle(); assert.equal(f.reloads, 0);
  f.quit(); f.stop('oom'); assert.equal(f.dialogs.length, 1);
});

test('a closed window cannot reload and releases its recovery listener', async () => {
  const f = fixture(); f.stop('crashed'); f.close(); f.finish(0); await settle();
  assert.equal(f.reloads, 0); assert.equal(f.window.webContents.listenerCount('render-process-gone'), 0);
});

for (const [locale, title] of [['ca-ES', 'Gnosi — recuperació de la pantalla'], ['en-US', 'Gnosi — screen recovery'], ['es-ES', 'Gnosi — recuperación de la pantalla'], ['fr-FR', 'Gnosi — récupération de l’écran']]) {
  test(`native recovery is translated for ${locale}`, async () => { const f = fixture(locale); f.stop('crashed'); assert.equal(f.dialogs[0].title, title); f.finish(1); await settle(); });
}

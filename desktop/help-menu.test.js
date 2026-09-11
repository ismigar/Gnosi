const assert = require('node:assert/strict');
const test = require('node:test');
const { documentationUrl } = require('./application-menu');
const { loadMainRuntime, senderEvent } = require('./test-helpers/main-runtime.cjs');

test('native documentation destinations normalize language and reject unknown topics', () => {
  assert.equal(documentationUrl('ca-ES', 'getting-started'), 'https://gnosi.temenosismael.org/Gnosi/learn/ca/getting-started/');
  assert.equal(documentationUrl(' FR_fr ', '', true), 'https://gnosi.temenosismael.org/Gnosi/engineering/fr/');
  assert.equal(documentationUrl('de', '../private'), 'https://gnosi.temenosismael.org/Gnosi/learn/');
});

test('native help commands use the renderer locale and preserve existing IPC callers', async () => {
  const runtime = loadMainRuntime();
  runtime.createWindow();
  const event = senderEvent(runtime.windows[0]);
  await runtime.handlers.get('set-application-menu')(event, { labels: {}, locale: 'es' });
  for (const label of ['Help center', 'Getting started', 'Engineering documentation']) {
    runtime.clickMenu(label);
  }
  const urls = runtime.calls.filter(call => call && call.external).map(call => call.external);
  assert.deepEqual(urls, [
    'https://gnosi.temenosismael.org/Gnosi/learn/es/',
    'https://gnosi.temenosismael.org/Gnosi/learn/es/getting-started/',
    'https://gnosi.temenosismael.org/Gnosi/engineering/es/',
  ]);
  await assert.rejects(async () => runtime.handlers.get('set-application-menu')(event, { locale: {} }), /Invalid menu locale/);
  await runtime.handlers.get('set-application-menu')(event, { labels: {} });
});

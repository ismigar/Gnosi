const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { loadMainRuntime } = require('./test-helpers/main-runtime.cjs');

for (const route of ['/index.html', '/vault/drawing', '/@fixture/knowledge/table/table-1']) {
  test(`packaged protocol serves origin-root assets after entry at ${route}`, async t => {
    const resourcesPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-app-assets-'));
    t.after(() => fs.rmSync(resourcesPath, { recursive: true, force: true }));
    const dist = path.join(resourcesPath, 'frontend', 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    const html = '<script type="module" src="/assets/index-fixture.js"></script>';
    const script = 'document.querySelector("#root").textContent = "Fixture";';
    fs.writeFileSync(path.join(dist, 'index.html'), html);
    fs.writeFileSync(path.join(dist, 'assets', 'index-fixture.js'), script);
    const runtime = loadMainRuntime({ resourcesPath });
    const handler = runtime.protocols.get('app');
    const entryUrl = `app://gnosi${route}`;
    const entry = await handler(new Request(entryUrl));
    assert.equal(entry.status, 200);
    assert.match(entry.headers.get('content-type'), /^text\/html/);
    assert.equal(await entry.text(), html);
    const assetUrl = new URL('/assets/index-fixture.js', entryUrl).href;
    assert.equal(assetUrl, 'app://gnosi/assets/index-fixture.js');
    const asset = await handler(new Request(assetUrl));
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type'), /^text\/javascript/);
    assert.equal(await asset.text(), script);
    // Static dispatch must not touch a backend, user profile, window or updater.
    assert.deepEqual(runtime.calls, []);
    assert.deepEqual(runtime.windows, []);
  });
}

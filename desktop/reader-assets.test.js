const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { verifyReaderAssets } = require('./scripts/verify-frontend-assets.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-reader-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ['host.html', 'reader.js', 'reader.css', 'pdf/build/pdf.mjs',
    'pdf/build/pdf.worker.mjs', 'pdf/web/viewer.html', 'pdf/web/viewer.css',
    'locales/en-US/zotero.ftl', 'locales/en-US/reader.ftl']) {
    const target = path.join(root, 'zotero-reader', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'fixture');
  }
  return root;
}

test('accepts a complete reader runtime', t => {
  assert.doesNotThrow(() => verifyReaderAssets(fixture(t)));
});

test('rejects an absent reader with an actionable build command', t => {
  const root = fixture(t);
  fs.rmSync(path.join(root, 'zotero-reader'), { recursive: true });
  assert.throws(() => verifyReaderAssets(root), /host.html.*build-zotero-reader.sh/);
});

test('rejects missing or empty PDF engine assets even when the shell is present', t => {
  const root = fixture(t);
  fs.rmSync(path.join(root, 'zotero-reader/pdf/build/pdf.worker.mjs'));
  fs.writeFileSync(path.join(root, 'zotero-reader/pdf/web/viewer.css'), '');
  assert.throws(() => verifyReaderAssets(root), /pdf.worker.mjs.*viewer.css/);
});

test('does not accept a directory in place of an asset', t => {
  const root = fixture(t);
  const file = path.join(root, 'zotero-reader/reader.js');
  fs.rmSync(file);
  fs.mkdirSync(file);
  assert.throws(() => verifyReaderAssets(root), /reader.js/);
});

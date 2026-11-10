const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const nodeTest = require('node:test');

// This reader build entry point is POSIX; Windows packaging uses native commands.
const test = process.platform === 'win32' ? nodeTest.skip : nodeTest;
const { verifyReaderAssets } = require('./scripts/verify-frontend-assets.cjs');

function buildFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-reader-build-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(name, content, executable = false) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, { mode: executable ? 0o755 : 0o644 });
  }
  for (const name of ['scripts/runtime/build-zotero-reader.sh',
    'desktop/scripts/verify-frontend-assets.cjs']) {
    write(name, fs.readFileSync(path.join(__dirname, '..', name)));
  }
  write('frontend/src/features/reader/zotero/zotero-host.html', 'Gnosi host');
  write('frontend/vendor/zotero-reader/src/index.web.js', 'fixture');
  write('frontend/vendor/zotero-reader/package-lock.json', 'unchanged lock');
  write('frontend/vendor/zotero-reader/.zotero-locale-commit', 'fixture');
  write('frontend/vendor/zotero-reader/pdfjs/build', `#!/bin/bash
set -eu
printf 'pdf:%s:%s\\n' "$PDFJS_CONFIG" "$NODE_OPTIONS" >> "$BUILD_TRACE"
test "$PDFJS_CONFIG" = web
for file in pdf/build/pdf.mjs pdf/build/pdf.worker.mjs pdf/web/viewer.html pdf/web/viewer.css; do
  mkdir -p "build/web/$(dirname "$file")"
  printf fixture > "build/web/$file"
done
`);
  write('bin/npm', `#!/bin/bash
set -eu
printf 'npm:%s:%s\\n' "$*" "$NODE_OPTIONS" >> "$BUILD_TRACE"
if [ "$1" = ci ]; then
  test "$*" = 'ci --no-audit --no-fund'
  test "$(cat package-lock.json)" = 'unchanged lock'
  exit "\${INSTALL_FAILURE:-0}"
fi
test "$*" = 'exec --no -- webpack --config-name web'
printf fixture > build/web/reader.js
printf fixture > build/web/reader.css
mkdir -p locales/en-US
printf fixture > locales/en-US/zotero.ftl
printf fixture > locales/en-US/reader.ftl
`, true);
  write('bin/curl', '#!/bin/bash\nexit 22\n', true);
  return {
    root,
    run(extraEnv = {}) {
      return spawnSync('bash', ['scripts/runtime/build-zotero-reader.sh'], {
        cwd: root, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
          NODE_OPTIONS: '--max-old-space-size=128', BUILD_TRACE: path.join(root, 'trace'), ...extraEnv },
      });
    },
  };
}

test('builds a complete web reader with locked dependencies and the caller memory limit', t => {
  const { root, run } = buildFixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  verifyReaderAssets(path.join(root, 'frontend/public'));
  assert.equal(fs.readFileSync(path.join(root, 'frontend/public/zotero-reader/host.html'), 'utf8'), 'Gnosi host');
  const trace = fs.readFileSync(path.join(root, 'trace'), 'utf8').trim().split('\n');
  assert.equal(trace.length, 3);
  assert.match(trace[0], /^npm:ci --no-audit --no-fund:/);
  assert.match(trace[1], /^pdf:web:/);
  assert.match(trace[2], /^npm:exec --no -- webpack --config-name web:/);
  for (const line of trace) assert.match(line, /--max-old-space-size=128 --openssl-legacy-provider$/);
  assert.equal(fs.readFileSync(path.join(root, 'frontend/vendor/zotero-reader/package-lock.json'), 'utf8'), 'unchanged lock');
});

test('a locked-install failure preserves the previous public runtime and stops compilation', t => {
  const { root, run } = buildFixture(t);
  const prior = path.join(root, 'frontend/public/zotero-reader/reader.js');
  fs.mkdirSync(path.dirname(prior), { recursive: true });
  fs.writeFileSync(prior, 'previous verified reader');
  const result = run({ INSTALL_FAILURE: '23' });
  assert.equal(result.status, 23);
  assert.equal(fs.readFileSync(prior, 'utf8'), 'previous verified reader');
  assert.equal(fs.readFileSync(path.join(root, 'trace'), 'utf8').trim().split('\n').length, 1);
});

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const script = path.join(__dirname, 'scripts/sync-release-version.cjs');
const packageSource = '{\n  "name": "fixture",\n  "version": "2.0.6"\n}\n';
const projectSource = '[project]\nname = "fixture"\nversion = "2.0.6"\n\n[tool.fixture]\nflag = true\n';

function fixture(t, sources = [packageSource, packageSource, packageSource, projectSource]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gnosi version 'fixture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = ['root.json', 'desktop.json', 'frontend.json', 'pyproject.toml']
    .map((name) => path.join(root, name));
  files.forEach((file, index) => fs.writeFileSync(file, sources[index]));
  const contents = () => files.map((file) => fs.readFileSync(file, 'utf8'));
  const run = (version = '3.0.0-rc.1') => spawnSync(process.execPath, [script, version, ...files], {
    cwd: root, encoding: 'utf8', timeout: 5000,
    env: { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
  });
  return { files, contents, run };
}

test('CLI synchronizes only the intended four values', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(f.contents(), [packageSource, packageSource, packageSource, projectSource]
    .map((source) => source.replace('2.0.6', '3.0.0-rc.1')));
});

test('invalid final TOML must not change any earlier manifest', (t) => {
  const f = fixture(t, [packageSource, packageSource, packageSource, '[tool.fixture]\nversion = "2.0.6"\n']);
  const before = f.contents();
  const result = f.run();
  assert.equal(result.status, 1);
  assert.deepEqual(f.contents(), before);
});

test('nested version preceding the root version is untouched', (t) => {
  const source = '{\n  "nested": {"version": "2.0.6"},\n  "version": "2.0.6"\n}\n';
  const f = fixture(t, [source, packageSource, packageSource, projectSource]);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.contents()[0], source.replace('\n  "version": "2.0.6"', '\n  "version": "3.0.0-rc.1"'));
});

test('compact JSON and escaped top-level version key preserve formatting', (t) => {
  const source = '{"nested":[{"version":"2.0.6"}],"ver\\u0073ion":"2.0.6","note":"braces { } and \\\"quote\\\""}\r\n';
  const f = fixture(t, [source, packageSource, packageSource, projectSource]);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.contents()[0], source.replace('ver\\u0073ion":"2.0.6"', 'ver\\u0073ion":"3.0.0-rc.1"'));
});

test('project table at EOF is supported without adding a newline', (t) => {
  const source = '[project]\nname = "fixture"\nversion = "2.0.6"';
  const f = fixture(t, [packageSource, packageSource, packageSource, source]);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.contents()[3], source.replace('2.0.6', '3.0.0-rc.1'));
});

test('repeated identical synchronization does not rewrite files', (t) => {
  const f = fixture(t);
  const timestamp = new Date('2020-01-01T00:00:00Z');
  f.files.forEach((file) => fs.utimesSync(file, timestamp, timestamp));
  const before = f.files.map((file) => fs.statSync(file).mtimeMs);
  const result = f.run('2.0.6');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.files.map((file) => fs.statSync(file).mtimeMs), before);
});

test('check mode is read-only and fails on any version mismatch', (t) => {
  const f = fixture(t);
  const before = f.contents();
  const passing = spawnSync(process.execPath, [script, '--check', '2.0.6', ...f.files], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(passing.status, 0, passing.stderr);
  const failing = spawnSync(process.execPath, [script, '--check', '3.0.0', ...f.files], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(failing.status, 1);
  assert.match(failing.stderr, /Release version mismatch/);
  assert.deepEqual(f.contents(), before);
});

for (const position of [0, 1, 2, 3]) {
  test(`unreadable or malformed input ${position + 1} leaves the other files unchanged`, (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.files[position], position === 3 ? '[project]\nversion = 7\n' : '{invalid');
    const before = f.contents();
    assert.equal(f.run().status, 1);
    assert.deepEqual(f.contents(), before);
    fs.unlinkSync(f.files[position]);
    assert.equal(f.run().status, 1);
    f.files.forEach((file, index) => {
      if (index !== position) assert.equal(fs.readFileSync(file, 'utf8'), before[index]);
    });
    assert.equal(fs.existsSync(f.files[position]), false);
  });
}

for (const source of [
  'null', '[]', '7', '"scalar"', '{}', '{"version":null}',
  '{"version": "1", "version": "2.0.6"}',
  '{"version": 1, "version": "2.0.6"}',
  '{"version": "1", "ver\\u0073ion": "2.0.6"}',
]) {
  test(`rejects missing, nonstring or ambiguous root version: ${source}`, (t) => {
    const f = fixture(t, [packageSource, packageSource, source, projectSource]);
    const before = f.contents();
    const result = f.run();
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.deepEqual(f.contents(), before);
  });
}

test('CRLF, comments, literal quotes and other TOML sections remain byte-identical', (t) => {
  const source = "[project] # ] in a comment\r\n'version'\t= '2.0.6'  # release\r\n[tool.fixture]\r\nversion = 'keep'\r\n";
  const f = fixture(t, [packageSource, packageSource, packageSource, source]);
  const result = f.run('3.0.0');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.contents()[3], source.replace('2.0.6', '3.0.0'));
});

test('multiline strings and nested arrays do not create fake TOML tables or version fields', (t) => {
  const source = '[project]\ndescription = """\n[project]\nversion = "keep"\n"""\n'
    + "notes = '''\n[project]\nversion = 'keep'\n'''\n"
    + 'matrix = [\n [1, 2],\n [3, 4]\n]\nversion = "2.0.6"\n'
    + '[[tool.fixture]]\nversion = "keep"\n';
  const f = fixture(t, [packageSource, packageSource, packageSource, source]);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.contents()[3], source.replace('2.0.6', '3.0.0-rc.1'));
});

for (const source of [
  '[project]\nversion = "2.0.6"\n[project]\nversion = "2.0.6"\n',
  '[project]\nversion = "2.0.6"\n"version" = "other"\n',
  '[project]\nversion = """2.0.6"""\n',
  '[project]\nversion = "2.0.6"\ndescription = "unterminated\n',
  '[project]\nversion = "2.0.6"\ndescription = """unterminated\n',
  '[project]\nversion = "2.0.6"\nmatrix = [1, 2\n',
]) {
  test(`rejects unsupported or ambiguous TOML without writes: ${JSON.stringify(source)}`, (t) => {
    const f = fixture(t, [packageSource, packageSource, packageSource, source]);
    const before = f.contents();
    assert.equal(f.run().status, 1);
    assert.deepEqual(f.contents(), before);
  });
}

for (const version of ['', 'v3.0.0', '3.0.0\n', '3.0.0\r', '3.0.0;touch marker', '$(touch marker)']) {
  test(`invalid CLI version cannot change any file: ${JSON.stringify(version)}`, (t) => {
    const f = fixture(t);
    const before = f.contents();
    assert.equal(f.run(version).status, 1);
    assert.deepEqual(f.contents(), before);
  });
}

test('second release-candidate invocation is byte- and mtime-idempotent', (t) => {
  const f = fixture(t);
  assert.equal(f.run('3.0.0-rc.1+build.5').status, 0);
  const before = f.contents();
  const timestamps = f.files.map((file) => fs.statSync(file, { bigint: true }).mtimeNs);
  assert.equal(f.run('3.0.0-rc.1+build.5').status, 0);
  assert.deepEqual(f.contents(), before);
  assert.deepEqual(f.files.map((file) => fs.statSync(file, { bigint: true }).mtimeNs), timestamps);
});

test('current checked-in manifest layouts work on disposable copies only', (t) => {
  const root = path.join(__dirname, '..');
  const paths = ['package.json', 'desktop/package.json', 'frontend/package.json', 'pyproject.toml'];
  const originals = paths.map((file) => fs.readFileSync(path.join(root, file), 'utf8'));
  const f = fixture(t, originals);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  f.contents().forEach((source, index) => {
    const before = originals[index];
    const expected = index === 3
      ? before.replace(/^version = "[^"]+"/m, 'version = "3.0.0-rc.1"')
      : before.replace(/^(  "version": )"[^"]+"/m, '$1"3.0.0-rc.1"');
    assert.equal(source, expected);
    assert.equal(fs.readFileSync(path.join(root, paths[index]), 'utf8'), before);
  });
});

for (const delimiter of ['"', "'"]) {
  for (const count of [4, 5]) {
    test(`TOML multiline delimiter ${delimiter} with ${count} closing quotes is not a fake table`, (t) => {
      const source = `[tool.fixture]\ntext = ${delimiter.repeat(3)}\n[project]\n${delimiter.repeat(count)}\n`
        + '[project]\nversion = "2.0.6"\n';
      const f = fixture(t, [packageSource, packageSource, packageSource, source]);
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(f.contents()[3], source.replace('2.0.6', '3.0.0-rc.1'));
    });
  }
}

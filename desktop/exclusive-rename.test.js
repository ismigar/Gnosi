const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { renameDirectoryNoReplace } = require('./exclusive-rename');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-exclusive-rename-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'original à');
  const destination = path.join(root, 'saved à');
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, 'payload.bin'), Buffer.from([0, 128, 255]));
  return { root, source, destination };
}

test('real OS no-replace rename preserves data and directory identity', t => {
  const f = fixture(t);
  const before = fs.statSync(f.source, { bigint: true });
  renameDirectoryNoReplace(f.source, f.destination);
  const after = fs.statSync(f.destination, { bigint: true });
  assert.equal(after.ino, before.ino);
  assert.equal(after.dev, before.dev);
  assert.equal(fs.existsSync(f.source), false);
  assert.deepEqual(fs.readFileSync(path.join(f.destination, 'payload.bin')), Buffer.from([0, 128, 255]));
});

for (const kind of ['empty directory', 'nonempty directory', 'file']) {
  test(`real OS refuses an existing ${kind} without replacing anything`, t => {
    const f = fixture(t);
    if (kind === 'file') fs.writeFileSync(f.destination, 'existing');
    else {
      fs.mkdirSync(f.destination);
      if (kind === 'nonempty directory') fs.writeFileSync(path.join(f.destination, 'existing'), 'keep');
    }
    const original = fs.statSync(f.source, { bigint: true });
    const existing = fs.statSync(f.destination, { bigint: true });
    assert.throws(() => renameDirectoryNoReplace(f.source, f.destination), /no-replace rename failed/);
    assert.equal(fs.statSync(f.source, { bigint: true }).ino, original.ino);
    assert.equal(fs.statSync(f.destination, { bigint: true }).ino, existing.ino);
    assert.deepEqual(fs.readFileSync(path.join(f.source, 'payload.bin')), Buffer.from([0, 128, 255]));
  });
}

test('invalid paths are rejected before native conversion', t => {
  const f = fixture(t);
  for (const invalid of ['relative', '', `${f.source}\0hidden`, null, 3]) {
    assert.throws(() => renameDirectoryNoReplace(invalid, f.destination), /absolute paths/);
    assert.throws(() => renameDirectoryNoReplace(f.source, invalid), /absolute paths/);
  }
  assert.equal(fs.existsSync(f.source), true);
  assert.equal(fs.existsSync(f.destination), false);
});

function platformFixture(platform, { failure = false, unavailable = false } = {}) {
  const calls = [];
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const source = platform === 'win32' ? 'C:\\fixture\\source' : '/fixture/source';
  const destination = platform === 'win32' ? 'C:\\fixture\\saved' : '/fixture/saved';
  const koffi = {
    errno: () => os.constants.errno.EEXIST,
    load: library => {
      calls.push({ library });
      return { func: (...signature) => {
        calls.push({ signature });
        if (unavailable) throw new Error('native symbol unavailable');
        return (...args) => {
          calls.push({ args });
          if (signature.includes('GetLastError')) return 183;
          return platform === 'win32' ? Number(!failure) : failure ? -1 : 0;
        };
      } };
    },
  };
  const context = {
    require: name => {
      if (name === 'node:path') return pathApi;
      if (name === 'node:os') return os;
      if (name === 'koffi') return koffi;
      assert.fail(`Unexpected dependency ${name}`);
    }, process: { platform }, module: { exports: {} },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'exclusive-rename.js'), 'utf8'), context);
  return { rename: () => context.module.exports.renameDirectoryNoReplace(source, destination), calls, source, destination, pathApi };
}

for (const platform of ['darwin', 'linux', 'win32']) {
  test(`${platform} binds only the explicit no-replace primitive and flags`, () => {
    const f = platformFixture(platform);
    f.rename();
    const nativeArguments = f.calls.filter(call => call.args).map(call => structuredClone(call.args));
    assert.deepEqual(nativeArguments, [platform === 'darwin' ? [f.source, f.destination, 4]
      : platform === 'linux' ? [-100, f.source, -100, f.destination, 1]
        : [f.pathApi.toNamespacedPath(f.source), f.pathApi.toNamespacedPath(f.destination), 8]]);
    assert.equal(f.calls[0].library, platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : platform === 'linux' ? 'libc.so.6' : 'kernel32.dll');
  });
  test(`${platform} reports native failure without any fallback`, () => {
    const f = platformFixture(platform, { failure: true });
    assert.throws(f.rename, /no-replace rename failed/);
    assert.equal(f.calls.filter(call => call.library).length, 1);
  });
  test(`${platform} fails closed when the required symbol is missing`, () => {
    const f = platformFixture(platform, { unavailable: true });
    assert.throws(f.rename, /native symbol unavailable/);
    assert.equal(f.calls.filter(call => call.args).length, 0);
  });
}

test('unsupported operating systems have no unsafe rename fallback', () => {
  const f = platformFixture('freebsd');
  assert.throws(f.rename, /unsupported/);
  assert.deepEqual(f.calls, []);
});

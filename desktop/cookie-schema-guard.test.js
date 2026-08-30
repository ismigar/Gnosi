const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { assertCookieDatabaseCompatible, assertProfileCookiesCompatible } = require('./cookie-schema-guard');

// Chromium23/24 layout; all records below are synthetic, with no keychain use.
const schema = `CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
  CREATE TABLE cookies(creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,
  name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,
  expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,
  last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,
  priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,
  source_port INTEGER NOT NULL,last_update_utc INTEGER NOT NULL,source_type INTEGER NOT NULL,
  has_cross_site_ancestor INTEGER NOT NULL);
  CREATE UNIQUE INDEX cookies_unique_index ON cookies(host_key,top_frame_site_key,has_cross_site_ancestor,name,path,source_scheme,source_port);`;

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-cookie-guard-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function create(relative = 'Cookies', version = 24, compatible = version) {
    const filename = path.join(root, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const db = new DatabaseSync(filename);
    try {
      db.exec(schema);
      db.prepare('INSERT INTO meta VALUES (?, ?)').run('version', String(version));
      db.prepare('INSERT INTO meta VALUES (?, ?)').run('last_compatible_version', String(compatible));
      db.exec("INSERT INTO cookies VALUES (1,'fixture.invalid','','synthetic','private-test-value',X'','/',2,0,0,1,1,1,1,-1,2,443,1,0,0)");
    } finally { db.close(); }
    return filename;
  }
  return { root, create };
}

for (const version of [23, 24]) {
  test(`compatible schema${version} is read without changing bytes`, t => {
    const value = fixture(t);
    const filename = value.create('Cookies', version);
    const before = fs.readFileSync(filename);
    assertProfileCookiesCompatible(value.root);
    assert.deepEqual(fs.readFileSync(filename), before);
    assert.deepEqual(fs.readdirSync(value.root), ['Cookies']);
  });
}

for (const version of [0, 18, 19, 20, 21, 22, 25, 'unknown']) {
  test(`unsupported schema${version} fails without resetting cookies`, t => {
    const value = fixture(t);
    const filename = value.create('Cookies', version);
    const before = fs.readFileSync(filename);
    assert.throws(() => assertProfileCookiesCompatible(value.root), error => {
      assert.match(error.message, /stopped before opening Chromium/);
      assert.match(error.message, /do not delete Cookies or change its version/);
      assert.doesNotMatch(error.message, /private-test-value/);
      return true;
    });
    assert.deepEqual(fs.readFileSync(filename), before);
  });
}

test('mismatched compatibility metadata is rejected', t => {
  const value = fixture(t);
  assert.throws(() => assertCookieDatabaseCompatible(value.create('Cookies', 24, 25)), /stopped before opening Chromium/);
});

test('fresh profiles do not create cookie databases or directories', t => {
  const { root } = fixture(t);
  assertProfileCookiesCompatible(root);
  assertProfileCookiesCompatible(path.join(root, 'absent'));
  assert.deepEqual(fs.readdirSync(root), []);
  assert.throws(() => assertProfileCookiesCompatible('relative'), /absolute/);
});

for (const relative of ['Network/Cookies', 'Partitions/example/Cookies', 'Partitions/example/Network/Cookies']) {
  test(`checks legacy cookie stores in ${relative}`, t => {
    const value = fixture(t);
    value.create('Cookies');
    const filename = value.create(relative, 19);
    const before = fs.readFileSync(filename);
    assert.throws(() => assertProfileCookiesCompatible(value.root), /stopped before opening Chromium/);
    assert.deepEqual(fs.readFileSync(filename), before);
  });
}

for (const suffix of ['-wal', '-shm', '-journal']) {
  test(`unresolved ${suffix} fails before SQLite can recover or modify it`, t => {
    const value = fixture(t);
    const filename = value.create();
    const before = fs.readFileSync(filename);
    fs.writeFileSync(`${filename}${suffix}`, 'unfinished synthetic writer');
    assert.throws(() => assertProfileCookiesCompatible(value.root), /stopped before opening Chromium/);
    assert.deepEqual(fs.readFileSync(filename), before);
    assert.equal(fs.readFileSync(`${filename}${suffix}`, 'utf8'), 'unfinished synthetic writer');
  });
}

for (const mutation of ['missing meta', 'missing column', 'corrupt file']) {
  test(`rejects ${mutation} without repairing the database`, t => {
    const value = fixture(t);
    const filename = value.create();
    if (mutation === 'corrupt file') fs.writeFileSync(filename, 'not SQLite');
    else {
      const db = new DatabaseSync(filename);
      try { db.exec(mutation === 'missing meta' ? 'DROP TABLE meta' : 'ALTER TABLE cookies DROP COLUMN value'); }
      finally { db.close(); }
    }
    const before = fs.readFileSync(filename);
    assert.throws(() => assertProfileCookiesCompatible(value.root), /stopped before opening Chromium/);
    assert.deepEqual(fs.readFileSync(filename), before);
  });
}

test('rejects cookie and profile symlinks without following them', { skip: process.platform === 'win32' }, t => {
  const value = fixture(t);
  const target = value.create('outside/Cookies');
  fs.symlinkSync(target, path.join(value.root, 'Cookies'));
  assert.throws(() => assertProfileCookiesCompatible(value.root), /stopped before opening Chromium/);
  fs.symlinkSync(path.join(value.root, 'outside'), path.join(value.root, 'alias'));
  assert.throws(() => assertProfileCookiesCompatible(path.join(value.root, 'alias')), /Symbolic links/);
  assert.equal(fs.lstatSync(path.join(value.root, 'Cookies')).isSymbolicLink(), true);
});

test('rejects a Cookies directory and hardlinked database', t => {
  const value = fixture(t);
  fs.mkdirSync(path.join(value.root, 'Cookies'));
  assert.throws(() => assertProfileCookiesCompatible(value.root), /stopped before opening Chromium/);
  const target = value.create('outside/Cookies');
  const alias = path.join(value.root, 'alias');
  fs.linkSync(target, alias);
  assert.throws(() => assertCookieDatabaseCompatible(alias), /stopped before opening Chromium/);
});

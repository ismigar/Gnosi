// @ts-check
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { inspectCookieSchema, migrateCookieSchema, cookieProjectionDigest } = require('./cookie-schema');
const { createSchema, insertCookie } = require('./test-helpers/cookie-schema-fixture.cjs');

/** @typedef {import('node:test').TestContext} TestContext */
/** @typedef {import('node:sqlite').SQLInputValue} SQLInputValue */
/** @param {TestContext} t @param {number} [version] @returns {DatabaseSync} */
function fixture(t, version = 23) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  createSchema(db, version);
  return db;
}

/** All reads preserve int64; snapshots also preserve byte arrays and TEXT NUL.
 * @param {DatabaseSync} db @returns {unknown}
 */
function snapshot(db) {
  /** @param {string} sql */
  const read = sql => {
    const statement = db.prepare(sql);
    statement.setReadBigInts(true);
    return statement.all();
  };
  return {
    schema: read('SELECT * FROM main.sqlite_schema ORDER BY name'),
    temp: read('SELECT * FROM sqlite_temp_schema ORDER BY name'),
    meta: read('SELECT hex(CAST(key AS BLOB)),hex(CAST(value AS BLOB)),typeof(value) FROM main.meta ORDER BY key'),
    cookies: read('SELECT * FROM main.cookies ORDER BY rowid'),
    textBytes: read('SELECT hex(CAST(value AS BLOB)),hex(encrypted_value) FROM main.cookies ORDER BY rowid'),
  };
}

for (const version of [19, 20, 21, 22, 23, 24]) {
  test(`schema${version}: exact inspection, projected fidelity, int64 and caller transaction`, t => {
    const db = fixture(t, version);
    insertCookie(db);
    insertCookie(db, { name: 'opaque', value: '', encrypted_value: Buffer.from([0, 255, 128, 0, 1]) });
    const original = snapshot(db);
    assert.deepEqual(inspectCookieSchema(db), { version, rowCount: 2, encryptedRows: 1 });
    const digest = cookieProjectionDigest(db);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.deepEqual(snapshot(db), original);
    assert.throws(() => migrateCookieSchema(db), /caller transaction/);
    assert.deepEqual(snapshot(db), original);

    db.exec('BEGIN IMMEDIATE');
    migrateCookieSchema(db);
    assert.equal(db.isTransaction, true);
    assert.deepEqual(inspectCookieSchema(db), { version: Math.max(23, version), rowCount: 2, encryptedRows: 1 });
    assert.equal(cookieProjectionDigest(db), digest);
    const statement = db.prepare('SELECT * FROM cookies ORDER BY name');
    statement.setReadBigInts(true);
    const rows = statement.all();
    assert.deepEqual(rows.map(row => row.creation_utc), [13370000000000001n, 13370000000000001n]);
    assert.equal(rows[0]?.expires_utc, 13380000000000003n);
    assert.equal(rows[0]?.last_access_utc, 13370000000000005n);
    assert.equal(rows[0]?.last_update_utc, 13370000000000007n);
    assert.deepEqual(rows[0]?.encrypted_value, new Uint8Array([0, 255, 128, 0, 1]));
    assert.equal(rows[0]?.source_scheme, version < 23 ? 2n : 0n);
    assert.equal(rows[0]?.has_cross_site_ancestor, 1n);
    assert.equal(rows[0]?.source_type, 0n);
    assert.ok(rows.every(row => !Object.hasOwn(row, 'is_same_party')));
    assert.equal(db.prepare("SELECT value FROM meta WHERE key='mmap_status'").get()?.value, '-1');
    assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    migrateCookieSchema(db);
    assert.equal(cookieProjectionDigest(db), digest);
    db.exec('ROLLBACK');
    assert.deepEqual(snapshot(db), original);

    db.exec('BEGIN');
    migrateCookieSchema(db);
    db.exec('COMMIT');
    assert.equal(db.isTransaction, false);
    assert.equal(cookieProjectionDigest(db), digest);
  });

  test(`schema${version}: empty store is supported`, t => {
    const db = fixture(t, version);
    assert.deepEqual(inspectCookieSchema(db), { version, rowCount: 0, encryptedRows: 0 });
    const digest = cookieProjectionDigest(db);
    db.exec('BEGIN');
    migrateCookieSchema(db);
    db.exec('COMMIT');
    assert.equal(cookieProjectionDigest(db), digest);
  });
}

for (const version of [19, 20, 21, 22]) {
  test(`schema${version}: digest matches independently constructed target23`, t => {
    const old = fixture(t, version);
    const expected = fixture(t, 23);
    /** @type {Record<string, SQLInputValue>[]} */
    const rows = [
      { name: 'first', host_key: '.sub.fixture.invalid', top_frame_site_key: 'https://fixture.invalid',
        source_scheme: 0n, is_secure: 1n },
      { name: 'second', top_frame_site_key: '', source_scheme: 1n, is_secure: 0n },
      { name: 'third', top_frame_site_key: 'https://other.invalid', source_scheme: 2n },
    ];
    rows.forEach((row, index) => {
      insertCookie(old, { ...row, ...(version >= 22 ? { source_type: 2n } : {}) });
      insertCookie(expected, { ...row, source_scheme: index === 0 ? 2n : row.source_scheme ?? 0n,
        has_cross_site_ancestor: index === 0 ? 0n : 1n, source_type: version >= 22 ? 2n : 0n });
    });
    assert.equal(cookieProjectionDigest(old), cookieProjectionDigest(expected));
    old.exec('BEGIN');
    migrateCookieSchema(old);
    old.exec('COMMIT');
    assert.equal(cookieProjectionDigest(old), cookieProjectionDigest(expected));
  });
}

test('Chromium ancestor substring/LIKE semantics and source normalization are exact', t => {
  const db = fixture(t, 22);
  const cases = [
    ['', '.fixture.invalid', 1],
    ['https://fixture.invalid', '.sub.fixture.invalid', 0],
    ['https://other.invalid', '.fixture.invalid', 1],
    ['https://ample.com', 'example.com', 0],
    ['https://example.com', 'ample.com', 1],
    ['https://EXAMPLE.COM', '.example.com', 0],
    ['example.com', 'example.com', 1],
    ['https://', 'example.com', 0],
    ['https://ex_mple.com', 'example.com', 0],
    ['https://%.com', 'example.com', 0],
  ];
  cases.forEach(([top, host], index) => insertCookie(db, {
    name: String(index), top_frame_site_key: String(top), host_key: String(host),
    source_scheme: BigInt(index % 3), is_secure: BigInt(index % 2), source_type: 2n,
  }));
  db.exec('BEGIN');
  migrateCookieSchema(db);
  db.exec('COMMIT');
  // Do not fetch complete cookie rows as Number: real Chromium timestamps exceed
  // the safe range and node:sqlite throws ERR_OUT_OF_RANGE. Always read BigInt.
  const statement = db.prepare('SELECT * FROM cookies ORDER BY CAST(name AS INTEGER)');
  statement.setReadBigInts(true);
  const rows = statement.all();
  cases.forEach((entry, index) => {
    assert.equal(rows[index]?.has_cross_site_ancestor, BigInt(entry[2] ?? -1));
    assert.equal(rows[index]?.source_scheme, BigInt(index % 3 === 0 && index % 2 === 1 ? 2 : index % 3));
    assert.equal(rows[index]?.source_type, 2n);
  });
});

for (const version of [19, 20, 21, 22, 23, 24]) {
  test(`schema${version}: cookie identity includes scope/source/ancestor only when defined`, t => {
    const db = fixture(t, version);
    insertCookie(db, { source_scheme: 2n });
    /** @type {Record<string, SQLInputValue>[]} */
    const distinctScope = [
      { host_key: '.other.invalid' }, { top_frame_site_key: 'https://other.invalid' },
      { name: 'another-name' }, { path: '/other' },
    ];
    distinctScope.forEach(overrides => insertCookie(db, { source_scheme: 2n, ...overrides }));
    if (version >= 20) {
      insertCookie(db, { source_scheme: 1n });
      insertCookie(db, { source_scheme: 2n, source_port: 8443n });
    } else {
      assert.throws(() => insertCookie(db, { source_scheme: 1n }), /UNIQUE/);
      assert.throws(() => insertCookie(db, { source_scheme: 2n, source_port: 8443n }), /UNIQUE/);
    }
    if (version >= 23) insertCookie(db, { source_scheme: 2n, has_cross_site_ancestor: 0n });
    assert.throws(() => insertCookie(db, { source_scheme: 2n, value: 'other' }), /UNIQUE/);
    if (version >= 22) assert.throws(() => insertCookie(db, { source_scheme: 2n, source_type: 2n }), /UNIQUE/);
    const count = inspectCookieSchema(db).rowCount;
    const digest = cookieProjectionDigest(db);
    db.exec('BEGIN');
    migrateCookieSchema(db);
    db.exec('COMMIT');
    assert.equal(inspectCookieSchema(db).rowCount, count);
    assert.equal(cookieProjectionDigest(db), digest);
  });
}

for (const version of [20, 21, 22]) {
  test(`schema${version}: normalization collision aborts without replacing either row; caller rollback restores everything`, t => {
    const db = fixture(t, version);
    insertCookie(db, { source_scheme: 0n, value: 'first-secret' });
    insertCookie(db, { source_scheme: 2n, value: 'second-secret', creation_utc: 13370000000000009n });
    const original = snapshot(db);
    const digest = cookieProjectionDigest(db);
    db.exec('BEGIN');
    assert.throws(() => migrateCookieSchema(db), error => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /UNIQUE/);
      assert.doesNotMatch(error.message, /first-secret|second-secret/);
      return true;
    });
    assert.equal(db.isTransaction, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cookies_old').get()?.n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM cookies').get()?.n, 0);
    db.exec('ROLLBACK');
    assert.deepEqual(snapshot(db), original);
    assert.equal(cookieProjectionDigest(db), digest);
  });
}

test('digest preserves int64 extremes, NUL, Unicode, blobs and insertion independence', t => {
  const a = fixture(t, 19);
  const b = fixture(t, 19);
  /** @type {Record<string, SQLInputValue>[]} */
  const rows = [
    { name: 'nul\0tail', value: 'x\0y😀é漢字', host_key: '.é.invalid',
      creation_utc: 9223372036854775807n, expires_utc: -9223372036854775808n,
      encrypted_value: Buffer.from([0, 255, 254, 128, 0, 65]) },
    { name: 'unicode😀', value: 'é', creation_utc: 9007199254740993n },
    { name: 'separators', value: '["value","blob","00"]\n\0' },
  ];
  rows.forEach(row => insertCookie(a, row));
  [...rows].reverse().forEach(row => insertCookie(b, row));
  const digest = cookieProjectionDigest(a);
  assert.equal(digest, cookieProjectionDigest(b));
  a.exec('BEGIN');
  migrateCookieSchema(a);
  a.exec('COMMIT');
  assert.equal(cookieProjectionDigest(a), digest);
  assert.equal(a.prepare("SELECT hex(CAST(value AS BLOB)) AS v FROM cookies WHERE creation_utc=9223372036854775807").get()?.v,
    Buffer.from('x\0y😀é漢字').toString('hex').toUpperCase());
  b.exec('UPDATE cookies SET creation_utc=creation_utc-1 WHERE creation_utc=9223372036854775807');
  assert.notEqual(cookieProjectionDigest(b), digest);
});

test('digest distinguishes complete text bytes, invalid UTF8, BLOB tags and REAL bits', t => {
  const db = fixture(t);
  insertCookie(db, { value: 'x\0tail' });
  const original = cookieProjectionDigest(db);
  db.prepare('UPDATE cookies SET value=?').run('x\0changed');
  assert.notEqual(cookieProjectionDigest(db), original);
  db.prepare('UPDATE cookies SET value=?').run(Buffer.from('x\0tail'));
  assert.notEqual(cookieProjectionDigest(db), original);
  db.exec("UPDATE cookies SET value=CAST(X'ff00fe' AS TEXT)");
  const invalidUtf8 = cookieProjectionDigest(db);
  db.exec("UPDATE cookies SET value=CAST(X'fe00ff' AS TEXT)");
  assert.notEqual(cookieProjectionDigest(db), invalidUtf8);
  db.exec('UPDATE cookies SET priority=1.25');
  const real = cookieProjectionDigest(db);
  db.exec('UPDATE cookies SET priority=1.2500000000000002');
  assert.notEqual(cookieProjectionDigest(db), real);
});

test('encrypted rows count bytes even when SQLite stores a NUL-prefixed TEXT value', t => {
  const db = fixture(t);
  insertCookie(db, { encrypted_value: '\0opaque' });
  assert.equal(inspectCookieSchema(db).encryptedRows, 1);
});

test('production module can load without a node:sqlite runtime import', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  /** @type {string[]} */
  const imports = [];
  const context = {
    module: { exports: {} },
    /** @param {string} name */
    require(name) {
      imports.push(name);
      assert.equal(name, 'node:crypto');
      return require('node:crypto');
    },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('./cookie-schema'), 'utf8'), context);
  assert.deepEqual(imports, ['node:crypto']);
  assert.deepEqual(Object.keys(context.module.exports).sort(),
    ['cookieProjectionDigest', 'inspectCookieSchema', 'migrateCookieSchema']);
});

test('digest covers every target field, excludes rowid and only retires same_party', t => {
  const db = fixture(t, 19);
  insertCookie(db);
  const original = cookieProjectionDigest(db);
  db.exec('UPDATE cookies SET is_same_party=987654321, rowid=91');
  assert.equal(cookieProjectionDigest(db), original);
  db.exec('BEGIN');
  migrateCookieSchema(db);
  db.exec('COMMIT');
  const columns = db.prepare('PRAGMA table_info(cookies)').all();
  for (const column of columns) {
    assert.equal(typeof column.name, 'string');
    const name = String(column.name);
    db.exec('SAVEPOINT change_field');
    if (column.type === 'TEXT') db.prepare(`UPDATE cookies SET ${name}=?`).run('other\0value');
    else if (column.type === 'BLOB') db.prepare(`UPDATE cookies SET ${name}=?`).run(Buffer.from([0, 255]));
    else db.exec(`UPDATE cookies SET ${name}=${name}+1`);
    assert.notEqual(cookieProjectionDigest(db), original, name);
    db.exec('ROLLBACK TO change_field; RELEASE change_field');
    assert.equal(cookieProjectionDigest(db), original);
  }
});

/** @type {[string, string][]} */
const unknownSchemas = [
  ['extra table', 'CREATE TABLE surprise(x)'],
  ['view', 'CREATE VIEW surprise AS SELECT name FROM cookies'],
  ['trigger', 'CREATE TRIGGER surprise AFTER INSERT ON cookies BEGIN SELECT 1; END'],
  ['temp shadow', 'CREATE TEMP TABLE cookies(x)'],
  ['temp trigger', 'CREATE TEMP TRIGGER surprise AFTER INSERT ON main.cookies BEGIN SELECT 1; END'],
  ['attached database', "ATTACH ':memory:' AS surprise"],
  ['extra column', 'ALTER TABLE cookies ADD COLUMN surprise INTEGER'],
  ['default', 'ALTER TABLE cookies ADD COLUMN surprise INTEGER NOT NULL DEFAULT 0'],
  ['generated column', 'ALTER TABLE cookies ADD COLUMN surprise INTEGER GENERATED ALWAYS AS (1) VIRTUAL'],
  ['missing unique index', 'DROP INDEX cookies_unique_index'],
  ['extra index', 'CREATE INDEX surprise ON cookies(name)'],
  ['nonunique index', 'DROP INDEX cookies_unique_index; CREATE INDEX cookies_unique_index ON cookies(host_key,top_frame_site_key,has_cross_site_ancestor,name,path,source_scheme,source_port)'],
  ['wrong key order', 'DROP INDEX cookies_unique_index; CREATE UNIQUE INDEX cookies_unique_index ON cookies(name,host_key,top_frame_site_key,has_cross_site_ancestor,path,source_scheme,source_port)'],
  ['missing source key', 'DROP INDEX cookies_unique_index; CREATE UNIQUE INDEX cookies_unique_index ON cookies(host_key,top_frame_site_key,has_cross_site_ancestor,name,path)'],
  ['collation', 'DROP INDEX cookies_unique_index; CREATE UNIQUE INDEX cookies_unique_index ON cookies(host_key COLLATE NOCASE,top_frame_site_key,has_cross_site_ancestor,name,path,source_scheme,source_port)'],
  ['descending key', 'DROP INDEX cookies_unique_index; CREATE UNIQUE INDEX cookies_unique_index ON cookies(host_key DESC,top_frame_site_key,has_cross_site_ancestor,name,path,source_scheme,source_port)'],
  ['partial index', 'DROP INDEX cookies_unique_index; CREATE UNIQUE INDEX cookies_unique_index ON cookies(host_key,top_frame_site_key,has_cross_site_ancestor,name,path,source_scheme,source_port) WHERE is_secure=1'],
  ['expression index', 'DROP INDEX cookies_unique_index; CREATE UNIQUE INDEX cookies_unique_index ON cookies(lower(host_key),top_frame_site_key,has_cross_site_ancestor,name,path,source_scheme,source_port)'],
  ['old version stamped onto new columns', "UPDATE meta SET value='19' WHERE key IN ('version','last_compatible_version')"],
  ['missing metadata', "DELETE FROM meta WHERE key='version'"],
  ['incompatible metadata', "UPDATE meta SET value='24' WHERE key='last_compatible_version'"],
];
for (const [label, sql] of unknownSchemas) {
  test(`unknown ${label} fails without mutating database`, t => {
    const db = fixture(t);
    insertCookie(db);
    db.exec(sql);
    const before = snapshot(db);
    assert.throws(() => inspectCookieSchema(db), /Unrecognized/);
    assert.throws(() => cookieProjectionDigest(db), /Unrecognized/);
    db.exec('BEGIN');
    assert.throws(() => migrateCookieSchema(db), /Unrecognized/);
    assert.equal(db.isTransaction, true);
    assert.deepEqual(snapshot(db), before);
    db.exec('ROLLBACK');
    assert.deepEqual(snapshot(db), before);
  });
}

for (const version of ['18', '25', '023', '23.0', '23\0', '23\n', '', 'unknown', Buffer.from('23')]) {
  test(`noncanonical metadata ${JSON.stringify(version)} is rejected unchanged`, t => {
    const db = fixture(t);
    db.prepare("UPDATE meta SET value=? WHERE key IN ('version','last_compatible_version')").run(version);
    const original = snapshot(db);
    assert.throws(() => inspectCookieSchema(db), /Unrecognized/);
    db.exec('BEGIN');
    assert.throws(() => migrateCookieSchema(db), /Unrecognized/);
    assert.deepEqual(snapshot(db), original);
    db.exec('ROLLBACK');
  });
}

for (const change of [
  ['wrong type', 'creation_utc INTEGER NOT NULL', 'creation_utc TEXT NOT NULL'],
  ['nullable column', 'creation_utc INTEGER NOT NULL', 'creation_utc INTEGER'],
  ['unexpected default', 'creation_utc INTEGER NOT NULL', 'creation_utc INTEGER NOT NULL DEFAULT 0'],
  ['hidden check', 'creation_utc INTEGER NOT NULL', 'creation_utc INTEGER NOT NULL CHECK(creation_utc > 0)'],
  ['conflict policy', 'value TEXT NOT NULL', "value TEXT NOT NULL ON CONFLICT REPLACE DEFAULT ''"],
  ['meta type', 'value LONGVARCHAR', 'value TEXT'],
]) {
  test(`rejects altered ${change[0]} with otherwise known names`, t => {
    const source = fixture(t);
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    const [label, before, after] = change;
    assert.ok(label && before && after);
    for (const row of source.prepare('SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid').all()) {
      assert.equal(typeof row.sql, 'string');
      db.exec(String(row.sql).replace(before, after));
    }
    db.exec("INSERT INTO meta VALUES('version','23'),('last_compatible_version','23')");
    const original = snapshot(db);
    assert.throws(() => inspectCookieSchema(db), /Unrecognized/);
    db.exec('BEGIN');
    assert.throws(() => migrateCookieSchema(db), /Unrecognized/);
    assert.deepEqual(snapshot(db), original);
    db.exec('ROLLBACK');
  });
}

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { createSchema, insertCookie } = require('./test-helpers/cookie-schema-fixture.cjs');
const { inspectCookieSchema, cookieProjectionDigest } = require('./cookie-schema');
const { migrateCookieStore } = require('./cookie-migration');
const { migrateProfileCookies } = require('./cookie-profile-migration');
const { rollbackCookieStore } = require('./cookie-rollback');

function hash(filename) { return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); }
function readInfo(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try { return { ...inspectCookieSchema(db), digest: cookieProjectionDigest(db) }; }
  finally { db.close(); }
}
function fixture(t, version = 19, relative = 'Cookies') {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'gnosi-cookie-migration-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  try { createSchema(db, version); insertCookie(db, { value: 'Synthetic cookie \u0000 català', creation_utc: 13390000000000001n }); }
  finally { db.close(); }
  const recovery = path.join(path.dirname(filename), '.Cookies.gnosi-cookie-recovery');
  return { root, filename, recovery, original: path.join(recovery, 'original.sqlite'),
    staged: path.join(recovery, 'staging', 'Cookies'), before: hash(filename), info: readInfo(filename) };
}

for (const version of [19, 20, 21, 22]) {
  test(`schema${version} migrates with exact original bytes and projected records retained`, t => {
    const value = fixture(t, version);
    const originalInode = fs.statSync(value.filename, { bigint: true }).ino;
    migrateCookieStore(value.filename);
    const migrated = readInfo(value.filename);
    assert.equal(migrated.version, 23);
    assert.equal(migrated.rowCount, value.info.rowCount);
    assert.equal(migrated.digest, value.info.digest);
    assert.equal(hash(value.original), value.before);
    assert.equal(fs.statSync(value.original, { bigint: true }).ino, originalInode);
    const currentHash = hash(value.filename);
    migrateCookieStore(value.filename);
    assert.equal(hash(value.filename), currentHash);
    assert.equal(hash(value.original), value.before);
    for (const name of ['intent.json', 'prepared.json', 'completed.json']) {
      assert.doesNotMatch(fs.readFileSync(path.join(value.recovery, name), 'utf8'), /Synthetic cookie/);
      if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(value.recovery, name)).mode & 0o777, 0o600);
    }
    if (process.platform !== 'win32') assert.equal(fs.statSync(value.recovery).mode & 0o777, 0o700);
  });
}

for (const version of [23, 24]) {
  test(`current schema${version} needs no migration or extra files`, t => {
    const value = fixture(t, version);
    migrateCookieStore(value.filename);
    assert.equal(hash(value.filename), value.before);
    assert.equal(fs.existsSync(value.recovery), false);
  });
}

for (const stage of ['intent', 'copied', 'transaction-started', 'before-commit', 'after-commit', 'prepared', 'original-preserved', 'target-activated', 'completed']) {
  test(`resumes safely after interruption at ${stage}`, t => {
    const value = fixture(t);
    assert.throws(() => migrateCookieStore(value.filename, { checkpoint: at => {
      if (at === stage) throw new Error(`interrupted ${stage}`);
    } }), new RegExp(`interrupted ${stage}`));
    const retained = fs.existsSync(value.original) ? value.original : value.filename;
    assert.equal(hash(retained), value.before, 'exact original bytes survive every interruption');
    migrateCookieStore(value.filename);
    assert.equal(readInfo(value.filename).digest, value.info.digest);
    assert.equal(readInfo(value.filename).version, 23);
    assert.equal(hash(value.original), value.before);
  });
}

test('newer browser cookie writes remain valid after completed migration', t => {
  const value = fixture(t);
  migrateCookieStore(value.filename);
  const db = new DatabaseSync(value.filename);
  try { db.exec("UPDATE cookies SET value='newer synthetic session'; UPDATE meta SET value='24' WHERE key IN ('version','last_compatible_version')"); }
  finally { db.close(); }
  const updated = hash(value.filename);
  migrateCookieStore(value.filename);
  assert.equal(hash(value.filename), updated);
  assert.equal(hash(value.original), value.before);
});

test('a corrupt prepared target is never activated', t => {
  const value = fixture(t);
  assert.throws(() => migrateCookieStore(value.filename, { checkpoint: stage => { if (stage === 'prepared') throw new Error('pause'); } }), /pause/);
  fs.appendFileSync(value.staged, 'corrupt target');
  assert.throws(() => migrateCookieStore(value.filename), /identity or bytes/);
  assert.equal(hash(value.filename), value.before);
  assert.equal(fs.existsSync(value.original), false);
});

test('another file appearing at activation is retained, never overwritten', t => {
  const value = fixture(t);
  assert.throws(() => migrateCookieStore(value.filename, { checkpoint: stage => {
    if (stage === 'original-preserved') fs.writeFileSync(value.filename, 'competing writer', { flag: 'wx' });
  } }), /Another file appeared/);
  assert.equal(fs.readFileSync(value.filename, 'utf8'), 'competing writer');
  assert.equal(hash(value.original), value.before);
  assert.equal(fs.existsSync(value.staged), true);
});

test('unknown schema in a second profile prevents any first-profile activation', t => {
  const first = fixture(t);
  const second = fixture(t);
  const db = new DatabaseSync(second.filename);
  try { db.exec("UPDATE meta SET value='99' WHERE key='version'"); } finally { db.close(); }
  assert.throws(() => migrateProfileCookies([first.root, second.root]));
  assert.equal(hash(first.filename), first.before);
  assert.equal(fs.existsSync(first.recovery), false);
});

test('malformed recovery journal in a second profile is preflighted before any activation', t => {
  const first = fixture(t);
  const second = fixture(t);
  fs.mkdirSync(second.recovery, { mode: 0o700 });
  fs.writeFileSync(path.join(second.recovery, 'intent.json'), '{}');
  assert.throws(() => migrateProfileCookies([first.root, second.root]), /journal|intent/i);
  assert.equal(hash(first.filename), first.before);
  assert.equal(fs.existsSync(first.recovery), false);
});

for (const relative of ['Network/Cookies', 'Partitions/synthetic/Cookies', 'Partitions/synthetic/Network/Cookies', 'espai català/Cookies']) {
  test(`migrates a closed store at ${relative}`, t => {
    const value = fixture(t, 19, relative);
    if (relative.startsWith('espai')) migrateCookieStore(value.filename);
    else migrateProfileCookies([value.root]);
    assert.equal(readInfo(value.filename).version, 23);
    assert.equal(hash(value.original), value.before);
  });
}

test('unsupported encrypted cookies stop without archiving or modifying the original', t => {
  const value = fixture(t);
  const db = new DatabaseSync(value.filename);
  try { db.exec("UPDATE cookies SET encrypted_value=X'76313000'"); } finally { db.close(); }
  const before = hash(value.filename);
  assert.throws(() => migrateCookieStore(value.filename), /Encrypted cookie store/);
  assert.equal(hash(value.filename), before);
  assert.equal(fs.existsSync(value.recovery), false);
});

for (const stage of ['rollback-intent', 'rollback-prepared', 'rollback-current-preserved', 'rollback-restored', 'rollback-completed']) {
  test(`explicit rollback resumes at ${stage} and preserves newer cookies`, t => {
    const value = fixture(t);
    migrateCookieStore(value.filename);
    const db = new DatabaseSync(value.filename);
    try { db.exec("UPDATE cookies SET value='newer cookie to retain'"); } finally { db.close(); }
    const newerHash = hash(value.filename);
    assert.throws(() => rollbackCookieStore(value.filename, { checkpoint: at => {
      if (at === stage) throw new Error(`pause ${stage}`);
    } }), new RegExp(`pause ${stage}`));
    assert.equal(hash(value.original), value.before);
    assert.throws(() => migrateCookieStore(value.filename), /rollback is active/);
    rollbackCookieStore(value.filename);
    assert.equal(hash(value.filename), value.before);
    assert.equal(hash(path.join(value.recovery, 'rollback.current.sqlite')), newerHash);
    rollbackCookieStore(value.filename);
    assert.equal(hash(value.filename), value.before);
    assert.throws(() => migrateCookieStore(value.filename), /rollback is active/);
  });
}

test('a new file appearing during rollback is not overwritten', t => {
  const value = fixture(t);
  migrateCookieStore(value.filename);
  const migratedHash = hash(value.filename);
  assert.throws(() => rollbackCookieStore(value.filename, { checkpoint: at => {
    if (at === 'rollback-current-preserved') fs.writeFileSync(value.filename, 'new competing writer', { flag: 'wx' });
  } }), /Another file appeared during cookie rollback/);
  assert.equal(fs.readFileSync(value.filename, 'utf8'), 'new competing writer');
  assert.equal(hash(value.original), value.before);
  assert.equal(hash(path.join(value.recovery, 'rollback.current.sqlite')), migratedHash);
});

for (const stage of ['before-commit', 'original-preserved', 'target-activated']) {
  test(`recovers after abrupt process termination at ${stage}`, t => {
    const value = fixture(t);
    const marker = path.join(value.root, 'kill-checkpoint');
    const script = `const fs=require('node:fs');
      const {migrateCookieStore}=require(${JSON.stringify(require.resolve('./cookie-migration'))});
      migrateCookieStore(process.argv[1],{checkpoint(stage){
        if(stage===process.argv[2]) {fs.writeFileSync(process.argv[3],stage);process.kill(process.pid,'SIGKILL');}
      }});`;
    const result = spawnSync(process.execPath, ['-e', script, value.filename, stage, marker], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(marker, 'utf8'), stage);
    assert.equal(hash(fs.existsSync(value.original) ? value.original : value.filename), value.before);
    migrateCookieStore(value.filename);
    assert.equal(readInfo(value.filename).version, 23);
    assert.equal(readInfo(value.filename).digest, value.info.digest);
    assert.equal(hash(value.original), value.before);
  });
}

for (const stage of ['rollback-current-preserved', 'rollback-restored']) {
  test(`rollback recovers after abrupt process termination at ${stage}`, t => {
    const value = fixture(t);
    migrateCookieStore(value.filename);
    const migrated = hash(value.filename);
    const marker = path.join(value.root, 'kill-checkpoint');
    const script = `const fs=require('node:fs');
      const {rollbackCookieStore}=require(${JSON.stringify(require.resolve('./cookie-rollback'))});
      rollbackCookieStore(process.argv[1],{checkpoint(stage){
        if(stage===process.argv[2]) {fs.writeFileSync(process.argv[3],stage);process.kill(process.pid,'SIGKILL');}
      }});`;
    const result = spawnSync(process.execPath, ['-e', script, value.filename, stage, marker], { encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(marker, 'utf8'), stage);
    rollbackCookieStore(value.filename);
    assert.equal(hash(value.filename), value.before);
    assert.equal(hash(path.join(value.recovery, 'rollback.current.sqlite')), migrated);
  });
}

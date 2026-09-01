// @ts-check
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const files = require('./cookie-migration-files');
const schema = require('./cookie-schema');

/** @typedef {import('./cookie-migration-files').Intent} Intent */
/** @typedef {import('./cookie-migration-files').Prepared} Prepared */
/** @typedef {{checkpoint?: (stage: string) => void}} Options */

/** @param {string} filename */
function paths(filename) {
  if (!path.isAbsolute(filename) || path.basename(filename) !== 'Cookies') throw new Error('Expected an absolute Cookies store path.');
  const parent = path.dirname(filename);
  if (!files.stat(parent)?.isDirectory()) throw new Error('Cookie store parent must be a real directory.');
  const file = path.join(fs.realpathSync(parent), 'Cookies');
  const recovery = path.join(path.dirname(file), '.Cookies.gnosi-cookie-recovery');
  return { file, recovery, original: path.join(recovery, 'original.sqlite'),
    staging: path.join(recovery, 'staging'), staged: path.join(recovery, 'staging', 'Cookies'),
    intent: path.join(recovery, 'intent.json'), prepared: path.join(recovery, 'prepared.json'), completed: path.join(recovery, 'completed.json') };
}

/** @param {string} filename */
function assertClosed(filename) {
  files.regularFile(filename);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = files.stat(`${filename}${suffix}`);
    if (sidecar && (!sidecar.isFile() || sidecar.nlink !== 1n || sidecar.size > 0n)) {
      throw new Error('Cookie store has unresolved journal state. Close every older Gnosi instance cleanly.');
    }
  }
}

/** @param {import('node:sqlite').DatabaseSync} db */
function assertIntegrity(db) {
  const rows = db.prepare('PRAGMA integrity_check').all();
  if (rows.length !== 1 || rows[0]?.integrity_check !== 'ok') throw new Error('Cookie database integrity check failed.');
}

/** @param {string} filename */
function inspectFile(filename) {
  assertClosed(filename);
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(filename, { readOnly: true, allowExtension: false });
  try {
    db.exec('PRAGMA trusted_schema = OFF');
    const info = schema.inspectCookieSchema(db);
    assertIntegrity(db);
    // Standard Gnosi builds have Chromium cookie encryption disabled. Do not
    // let that runtime discard a custom encrypted store it cannot decrypt.
    if (info.encryptedRows !== 0) throw new Error('Encrypted cookie store requires its original encryption-enabled runtime; no values or keys were changed.');
    return { ...info, projectedDigest: schema.cookieProjectionDigest(db) };
  } finally { db.close(); }
}

/** @param {ReturnType<typeof paths>} p */
function validateRecovery(p) {
  const info = files.stat(p.recovery);
  if (!info) return false;
  if (!info.isDirectory() || (process.platform !== 'win32' && (info.mode & 0o077n) !== 0n)) throw new Error('Cookie recovery directory is not private.');
  for (const name of fs.readdirSync(p.recovery)) {
    if (!['intent.json', 'prepared.json', 'completed.json', 'original.sqlite', 'staging',
      'rollback.intent.json', 'rollback.prepared.json', 'rollback.completed.json', 'rollback.current.sqlite', 'restore.sqlite'].includes(name)
      && !/^attempt-[a-f0-9-]{36}$/.test(name)) throw new Error('Unrecognized cookie recovery state; retain all files.');
    files.stat(path.join(p.recovery, name)); // Reject even unused symlink entries.
  }
  return true;
}

/** @param {ReturnType<typeof paths>} p @param {Intent} intent @param {Options} options */
function prepareTarget(p, intent, options) {
  files.assertIdentity(p.file, intent.source);
  if (files.stat(p.original)) throw new Error('Original archive exists without a verified prepared journal.');
  if (files.stat(p.staging)) {
    if (!files.stat(p.staging)?.isDirectory()) throw new Error('Cookie staging path is not a directory.');
    files.move(p.staging, path.join(p.recovery, `attempt-${crypto.randomUUID()}`));
  }
  fs.mkdirSync(p.staging, { mode: 0o700 });
  fs.copyFileSync(p.file, p.staged, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(p.staged, 0o600);
  if (files.digestFile(p.staged) !== intent.source.sha256) throw new Error('Cookie staging copy differs from the original.');
  options.checkpoint?.('copied');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(p.staged, { allowExtension: false });
  let committed = false;
  try {
    db.exec('PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; BEGIN EXCLUSIVE');
    options.checkpoint?.('transaction-started');
    schema.migrateCookieSchema(db);
    const info = schema.inspectCookieSchema(db);
    if (info.version !== 23 || info.rowCount !== intent.rowCount || schema.cookieProjectionDigest(db) !== intent.projectedDigest) {
      throw new Error('Cookie migration changed records unexpectedly.');
    }
    assertIntegrity(db);
    options.checkpoint?.('before-commit');
    db.exec('COMMIT');
    committed = true;
    options.checkpoint?.('after-commit');
  } finally {
    if (!committed && db.isTransaction) db.exec('ROLLBACK');
    db.close();
  }
  assertClosed(p.staged);
  files.syncFile(p.staged);
  files.syncDirectory(p.staging);
  /** @type {Prepared} */
  const prepared = { format: 1, sourceHash: intent.source.sha256, target: files.identity(p.staged) };
  files.writeJournal(p.prepared, prepared);
  options.checkpoint?.('prepared');
  return prepared;
}

/** Validate all stores before any activation; interrupted activation may have no current filename.
 * @param {string} filename
 */
function preflightCookieStore(filename) {
  const p = paths(filename);
  const recovery = validateRecovery(p);
  if (files.stat(path.join(p.recovery, 'rollback.intent.json'))) {
    throw new Error('Cookie rollback is active. Finish recovery and use the previous Gnosi version; do not restart Electron43 on this profile.');
  }
  if (!recovery || fs.readdirSync(p.recovery).length === 0) return files.stat(p.file) ? inspectFile(p.file) : undefined;
  const intent = files.readIntent(p.intent, p.file);
  if (!files.stat(p.prepared)) {
    if (files.stat(p.original) || files.stat(p.completed)) throw new Error('Cookie original moved without a prepared journal.');
    files.assertIdentity(p.file, intent.source);
    return inspectFile(p.file);
  }
  const prepared = files.readPrepared(p.prepared, intent);
  if (files.stat(p.completed)) {
    if (JSON.stringify(files.readPrepared(p.completed, intent)) !== JSON.stringify(prepared)) throw new Error('Cookie completion differs from preparation.');
    files.assertIdentity(p.original, intent.source);
    const info = inspectFile(p.file);
    if (info.version < 23) throw new Error('Completed migration has an older current cookie schema.');
    return info;
  }
  if (!files.stat(p.original)) {
    files.assertIdentity(p.file, intent.source);
    files.assertIdentity(p.staged, prepared.target);
    return inspectFile(p.file);
  }
  files.assertIdentity(p.original, intent.source);
  if (files.stat(p.file)) {
    if (files.stat(p.staged)) throw new Error('Conflicting current and staged cookie stores.');
    files.assertIdentity(p.file, prepared.target);
    return inspectFile(p.file);
  }
  files.assertIdentity(p.staged, prepared.target);
  return inspectFile(p.staged);
}

/** Atomically activate a verified staged schema while retaining exact original bytes.
 * The caller owns the profile lock and has preflighted every selected store.
 * @param {string} filename @param {Options} [options]
 */
function migrateCookieStore(filename, options = {}) {
  const p = paths(filename);
  const info = preflightCookieStore(p.file);
  if (!info) return;
  if (!files.stat(p.intent)) {
    if (info.version >= 23) return;
    if (!files.stat(p.recovery)) { fs.mkdirSync(p.recovery, { mode: 0o700 }); files.syncDirectory(path.dirname(p.recovery)); }
    if (fs.readdirSync(p.recovery).length !== 0) throw new Error('Cookie recovery state has no recognized intent.');
    /** @type {Intent} */
    const intent = { format: 1, file: p.file, source: files.identity(p.file), sourceVersion: info.version, rowCount: info.rowCount, projectedDigest: info.projectedDigest };
    files.writeJournal(p.intent, intent);
    options.checkpoint?.('intent');
  }
  const intent = files.readIntent(p.intent, p.file);
  const prepared = files.stat(p.prepared) ? files.readPrepared(p.prepared, intent) : prepareTarget(p, intent, options);
  if (files.stat(p.completed)) {
    const completed = files.readPrepared(p.completed, intent);
    if (JSON.stringify(completed) !== JSON.stringify(prepared)) throw new Error('Cookie completion does not match preparation.');
    files.assertIdentity(p.original, intent.source);
    if (!files.stat(p.file) || inspectFile(p.file).version < 23) throw new Error('Completed cookie migration has an incompatible current store.');
    return;
  }
  if (!files.stat(p.original)) {
    files.assertIdentity(p.file, intent.source);
    assertClosed(p.file);
    files.assertIdentity(p.staged, prepared.target);
    files.move(p.file, p.original);
    options.checkpoint?.('original-preserved');
  }
  files.assertIdentity(p.original, intent.source);
  if (files.stat(p.file)) {
    if (files.stat(p.staged)) throw new Error('Another file appeared at the cookie activation path; original and staging are retained.');
    files.assertIdentity(p.file, prepared.target);
  } else {
    files.assertIdentity(p.staged, prepared.target);
    files.move(p.staged, p.file);
    options.checkpoint?.('target-activated');
    files.assertIdentity(p.file, prepared.target);
  }
  files.writeJournal(p.completed, prepared);
  options.checkpoint?.('completed');
}

module.exports = { migrateCookieStore, preflightCookieStore, cookieMigrationPaths: paths, inspectCookieStore: inspectFile, validateCookieRecovery: validateRecovery };

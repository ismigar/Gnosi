// @ts-check
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const files = require('./cookie-migration-files');
const { cookieMigrationPaths, inspectCookieStore, validateCookieRecovery } = require('./cookie-migration');

/** Explicit recovery only, with all clients stopped. Preserve newer cookies too.
 * A pending forward activation must first be resumed to its verified completion.
 * @param {string} filename
 * @param {{checkpoint?: (stage: string) => void}} [options]
 */
function rollbackCookieStore(filename, options = {}) {
  const p = cookieMigrationPaths(filename);
  if (!validateCookieRecovery(p)) throw new Error('No cookie migration exists to roll back.');
  const intent = files.readIntent(p.intent, p.file);
  const prepared = files.readPrepared(p.prepared, intent);
  if (JSON.stringify(files.readPrepared(p.completed, intent)) !== JSON.stringify(prepared)) {
    throw new Error('Resume the pending cookie migration before requesting rollback.');
  }
  files.assertIdentity(p.original, intent.source);
  const rollbackIntentFile = path.join(p.recovery, 'rollback.intent.json');
  const rollbackPreparedFile = path.join(p.recovery, 'rollback.prepared.json');
  const rollbackCompletedFile = path.join(p.recovery, 'rollback.completed.json');
  const savedCurrent = path.join(p.recovery, 'rollback.current.sqlite');
  const restore = path.join(p.recovery, 'restore.sqlite');
  if (!files.stat(rollbackIntentFile)) {
    inspectCookieStore(p.file); // Refuse unresolved journal/writer state.
    files.writeJournal(rollbackIntentFile, { format: 1, sourceHash: intent.source.sha256, target: files.identity(p.file) });
    options.checkpoint?.('rollback-intent');
  }
  const rollbackIntent = files.readPrepared(rollbackIntentFile, intent);
  if (!files.stat(rollbackPreparedFile)) {
    files.assertIdentity(p.file, rollbackIntent.target);
    if (files.stat(restore)) files.move(restore, path.join(p.recovery, `attempt-${crypto.randomUUID()}`));
    fs.copyFileSync(p.original, restore, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(restore, 0o600);
    if (files.digestFile(restore) !== intent.source.sha256) throw new Error('Cookie restore copy did not verify.');
    files.syncFile(restore);
    files.writeJournal(rollbackPreparedFile, { format: 1, sourceHash: intent.source.sha256, target: files.identity(restore) });
    options.checkpoint?.('rollback-prepared');
  }
  const rollbackPrepared = files.readPrepared(rollbackPreparedFile, intent);
  if (files.stat(rollbackCompletedFile)) {
    if (JSON.stringify(files.readPrepared(rollbackCompletedFile, intent)) !== JSON.stringify(rollbackPrepared)) {
      throw new Error('Cookie rollback completion differs from its preparation.');
    }
    files.assertIdentity(savedCurrent, rollbackIntent.target);
    if (inspectCookieStore(p.file).version !== intent.sourceVersion) throw new Error('Restored cookie store has an unexpected schema.');
    return;
  }
  if (!files.stat(savedCurrent)) {
    files.assertIdentity(p.file, rollbackIntent.target);
    files.assertIdentity(restore, rollbackPrepared.target);
    files.move(p.file, savedCurrent);
    options.checkpoint?.('rollback-current-preserved');
  }
  files.assertIdentity(savedCurrent, rollbackIntent.target);
  if (files.stat(p.file)) {
    if (files.stat(restore)) throw new Error('Another file appeared during cookie rollback; every version was retained.');
    files.assertIdentity(p.file, rollbackPrepared.target);
  } else {
    files.assertIdentity(restore, rollbackPrepared.target);
    files.move(restore, p.file);
    options.checkpoint?.('rollback-restored');
  }
  if (files.digestFile(p.file) !== intent.source.sha256) throw new Error('Restored cookie bytes differ from the original.');
  files.writeJournal(rollbackCompletedFile, rollbackPrepared);
  options.checkpoint?.('rollback-completed');
}

module.exports = { rollbackCookieStore };

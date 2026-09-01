// @ts-check
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { renameDirectoryNoReplace: moveNoReplace } = require('./exclusive-rename');

/** @typedef {{device: string, inode: string, sha256: string}} Identity */
/** @typedef {{format: 1, file: string, source: Identity, sourceVersion: number, rowCount: number, projectedDigest: string}} Intent */
/** @typedef {{format: 1, sourceHash: string, target: Identity}} Prepared */

/** @param {string} filename */
function stat(filename) {
  try {
    const value = fs.lstatSync(filename, { bigint: true });
    if (value.isSymbolicLink()) throw new Error('Cookie migration refuses symbolic links.');
    return value;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** @param {string} filename */
function regularFile(filename) {
  const value = stat(filename);
  if (!value?.isFile() || value.nlink !== 1n) throw new Error('Cookie migration requires an existing unshared regular file.');
  return value;
}

/** @param {string} directory */
function syncDirectory(directory) {
  if (process.platform === 'win32') return;
  const fd = fs.openSync(directory, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** @param {string} filename */
function syncFile(filename) {
  // These are newly created staging copies; Windows FlushFileBuffers requires
  // a write-capable handle even though no additional bytes are being changed.
  const fd = fs.openSync(filename, 'r+');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

/** Hash without loading a potentially large browser store into memory. @param {string} filename */
function digestFile(filename) {
  regularFile(filename);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
    return hash.digest('hex');
  } finally { fs.closeSync(fd); }
}

/** @param {string} filename @returns {Identity} */
function identity(filename) {
  const before = regularFile(filename);
  const sha256 = digestFile(filename);
  const after = regularFile(filename);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs) {
    throw new Error('Cookie store changed while it was being verified. Close older clients.');
  }
  return { device: String(before.dev), inode: String(before.ino), sha256 };
}

/** @param {string} filename @param {Identity} expected */
function assertIdentity(filename, expected) {
  const actual = identity(filename);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Cookie file identity or bytes no longer match the recovery journal.');
}

/** @param {string} filename @param {Intent | Prepared} value */
function writeJournal(filename, value) {
  const fd = fs.openSync(filename, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(value)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  syncDirectory(path.dirname(filename));
}

/** @param {unknown} value @param {string[]} keys @returns {asserts value is Record<string, unknown>} */
function assertKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(',')) {
    throw new Error('Malformed cookie migration journal.');
  }
}

/** @param {unknown} value @returns {Identity} */
function decodeIdentity(value) {
  assertKeys(value, ['device', 'inode', 'sha256']);
  if (typeof value.device !== 'string' || !/^\d+$/.test(value.device)
    || typeof value.inode !== 'string' || !/^\d+$/.test(value.inode)
    || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
    throw new Error('Malformed cookie file identity.');
  }
  return { device: value.device, inode: value.inode, sha256: value.sha256 };
}

/** @param {string} filename @returns {unknown} */
function readJournal(filename) {
  const value = regularFile(filename);
  if (value.size > 16_384n) throw new Error('Oversized cookie migration journal.');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

/** @param {string} filename @param {string} sourceFile @returns {Intent} */
function readIntent(filename, sourceFile) {
  const value = readJournal(filename);
  assertKeys(value, ['format', 'file', 'source', 'sourceVersion', 'rowCount', 'projectedDigest']);
  if (value.format !== 1 || value.file !== sourceFile
    || typeof value.sourceVersion !== 'number' || ![19, 20, 21, 22].includes(value.sourceVersion)
    || typeof value.rowCount !== 'number' || !Number.isSafeInteger(value.rowCount) || value.rowCount < 0
    || typeof value.projectedDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.projectedDigest)) {
    throw new Error('Unrecognized cookie migration intent.');
  }
  return { format: 1, file: sourceFile, source: decodeIdentity(value.source), sourceVersion: value.sourceVersion, rowCount: value.rowCount, projectedDigest: value.projectedDigest };
}

/** @param {string} filename @param {Intent} intent @returns {Prepared} */
function readPrepared(filename, intent) {
  const value = readJournal(filename);
  assertKeys(value, ['format', 'sourceHash', 'target']);
  if (value.format !== 1 || value.sourceHash !== intent.source.sha256) throw new Error('Cookie migration journal does not match its original.');
  return { format: 1, sourceHash: intent.source.sha256, target: decodeIdentity(value.target) };
}

/** @param {string} source @param {string} destination */
function move(source, destination) {
  // The underlying OS no-replace primitive supports files as well as directories.
  moveNoReplace(source, destination);
  syncDirectory(path.dirname(source));
  syncDirectory(path.dirname(destination));
}

module.exports = { assertIdentity, digestFile, identity, move, readIntent, readPrepared, regularFile, stat, syncDirectory, syncFile, writeJournal };

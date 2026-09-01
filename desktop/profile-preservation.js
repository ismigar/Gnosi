// @ts-check
const fs = require('node:fs');
const path = require('node:path');
const exclusiveRename = require('./exclusive-rename');

/** @typedef {{version: 1, profile: string, device: string, inode: string}} Intent */
/** @typedef {{status: 'absent' | 'preserved', recoveryDirectory: string}} Preservation */

/** @param {string} message @returns {never} */
function fail(message) {
  throw new Error(`Desktop profile preservation stopped: ${message}. Close older Gnosi instances and consult the desktop recovery instructions; no data will be overwritten.`);
}

/** @param {string} filename */
function stat(filename) {
  try { return fs.lstatSync(filename, { bigint: true }); }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** @param {string} directory */
function directoryStat(directory) {
  const info = stat(directory);
  if (info && !info.isDirectory()) fail(`expected a real directory at ${directory}`);
  return info;
}

/** @param {string} directory */
function syncDirectory(directory) {
  // Windows does not expose directory fsync through Node. File journals are
  // still flushed; interrupted/ambiguous directory states fail closed on rerun.
  if (process.platform === 'win32') return;
  const descriptor = fs.openSync(directory, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

/** @param {string} filename @param {Intent} intent */
function writeJournal(filename, intent) {
  const descriptor = fs.openSync(filename, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(intent)}\n`);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  syncDirectory(path.dirname(filename));
}

/** @param {string} filename @param {string} profile @returns {Intent} */
function readJournal(filename, profile) {
  const info = stat(filename);
  if (!info?.isFile() || info.nlink !== 1n || info.size > 16_384n) fail(`invalid journal at ${filename}`);
  /** @type {unknown} */
  const value = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!value || typeof value !== 'object'
    || !('version' in value) || value.version !== 1
    || !('profile' in value) || value.profile !== profile
    || !('device' in value) || typeof value.device !== 'string' || !/^\d+$/.test(value.device)
    || !('inode' in value) || typeof value.inode !== 'string' || !/^\d+$/.test(value.inode)
    || Object.keys(value).sort().join(',') !== 'device,inode,profile,version') {
    fail(`unrecognized journal at ${filename}`);
  }
  return { version: 1, profile, device: value.device, inode: value.inode };
}

/** @param {import('node:fs').BigIntStats} info @param {Intent} intent */
function assertIdentity(info, intent) {
  if (String(info.dev) !== intent.device || String(info.ino) !== intent.inode) {
    fail('the saved directory identity does not match its journal');
  }
}

/** @param {string} parent @param {string} candidate */
function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Resolve existing ancestors without requiring the final path to exist. @param {string} filename @returns {string} */
function canonicalPath(filename) {
  if (stat(filename)) return fs.realpathSync(filename);
  const parent = path.dirname(filename);
  if (parent === filename) fail('cannot resolve the profile volume');
  return path.join(canonicalPath(parent), path.basename(filename));
}

/**
 * Preserve obsolete Chromium WebSQL storage before any session is opened.
 * The caller must hold the profile's single-instance lock and stop old clients.
 * Never copy, delete, checkpoint, or traverse the opaque payload's contents.
 * @param {string} profilePath
 * @param {readonly string[]} [protectedDataPaths] Absolute effective app-data paths.
 * @returns {Preservation}
 */
function preserveLegacyProfile(profilePath, protectedDataPaths = []) {
  if (!path.isAbsolute(profilePath) || path.dirname(profilePath) === profilePath) fail('unsafe profile root');
  directoryStat(profilePath); // Reject a symlink at the profile root itself.
  const profile = canonicalPath(profilePath);
  const recoveryDirectory = path.join(path.dirname(profile), `.${path.basename(profile)}.gnosi-electron-recovery`);
  const source = path.join(profile, 'databases');
  const saved = path.join(recoveryDirectory, 'databases.saved');
  const intentFile = path.join(recoveryDirectory, 'intent.json');
  const completedFile = path.join(recoveryDirectory, 'completed.json');
  const sourceInfo = directoryStat(source);
  const recoveryInfo = directoryStat(recoveryDirectory);
  if (!sourceInfo && !recoveryInfo) return { status: 'absent', recoveryDirectory };
  for (const configured of protectedDataPaths) {
    if (!path.isAbsolute(configured)) fail('application data path must be absolute');
    const resolved = canonicalPath(configured);
    if (isWithin(source, resolved) || isWithin(recoveryDirectory, resolved)) {
      fail('configured application data overlaps legacy Chromium recovery storage');
    }
  }
  if (!recoveryInfo) {
    fs.mkdirSync(recoveryDirectory, { mode: 0o700 });
    syncDirectory(path.dirname(recoveryDirectory));
  }
  const names = fs.readdirSync(recoveryDirectory);
  if (names.some(name => !['intent.json', 'completed.json', 'databases.saved'].includes(name))) {
    fail('recovery directory contains unknown entries');
  }
  const savedInfo = directoryStat(saved);
  if (sourceInfo && savedInfo) fail('both original and saved directories exist');
  if (!sourceInfo && !savedInfo) {
    if (names.length) fail('journal exists but its directory is missing');
    return { status: 'absent', recoveryDirectory };
  }
  /** @type {Intent} */
  let intent;
  if (names.includes('intent.json')) {
    intent = readJournal(intentFile, profile);
  } else {
    if (!sourceInfo || names.length) fail('recovery state has no valid intent journal');
    intent = { version: 1, profile, device: String(sourceInfo.dev), inode: String(sourceInfo.ino) };
    writeJournal(intentFile, intent);
  }
  if (savedInfo) {
    assertIdentity(savedInfo, intent);
    if (names.includes('completed.json')) {
      const completed = readJournal(completedFile, profile);
      if (JSON.stringify(completed) !== JSON.stringify(intent)) fail('completion journal does not match intent');
    } else {
      syncDirectory(profile);
      syncDirectory(recoveryDirectory);
      writeJournal(completedFile, intent);
    }
  } else {
    if (!sourceInfo || names.includes('completed.json')) fail('completed recovery unexpectedly has a source directory');
    assertIdentity(sourceInfo, intent);
    // Atomic same-volume rename; EXDEV and IO failures propagate without any
    // copy fallback. The durable intent allows a later process to resume.
    exclusiveRename.renameDirectoryNoReplace(source, saved);
    const moved = directoryStat(saved);
    if (!moved || stat(source)) fail('cannot verify the renamed directory');
    assertIdentity(moved, intent);
    syncDirectory(profile);
    syncDirectory(recoveryDirectory);
    writeJournal(completedFile, intent);
  }
  return { status: 'preserved', recoveryDirectory };
}

module.exports = { preserveLegacyProfile };

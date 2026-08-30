// @ts-check
const fs = require('node:fs');
const path = require('node:path');

const COOKIE_COLUMNS = Object.freeze([
  'creation_utc', 'host_key', 'top_frame_site_key', 'name', 'value',
  'encrypted_value', 'path', 'expires_utc', 'is_secure', 'is_httponly',
  'last_access_utc', 'has_expires', 'is_persistent', 'priority', 'samesite',
  'source_scheme', 'source_port', 'last_update_utc', 'source_type',
  'has_cross_site_ancestor',
]);

/** @param {string} filename @returns {fs.Stats | undefined} */
function existing(filename) {
  try {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not supported in cookie profiles.');
    return stat;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Read schema metadata only. Never migrate, reset, decrypt or log cookie values.
 * @param {string} filename
 */
function assertCookieDatabaseCompatible(filename) {
  try {
    const stat = existing(filename);
    if (!stat) return;
    if (!stat.isFile() || stat.nlink !== 1) throw new Error('Cookies must be a regular, unshared file.');
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = existing(`${filename}${suffix}`);
      if (sidecar && (!sidecar.isFile() || sidecar.nlink !== 1 || sidecar.size > 0)) {
        throw new Error('Cookie database has unresolved journal state. Close all older clients cleanly.');
      }
    }
    // Lazy loading keeps legacy Electron 28 seed probes compatible with Node18.
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(filename, { readOnly: true, allowExtension: false });
    try {
      database.exec('PRAGMA trusted_schema = OFF');
      const version = database.prepare("SELECT value FROM meta WHERE key='version'").get()?.value;
      const compatible = database.prepare("SELECT value FROM meta WHERE key='last_compatible_version'").get()?.value;
      // Chromium150 only implements 23->24; older versions are deleted upstream.
      if (!['23', '24'].includes(String(version)) || String(compatible) !== String(version)) {
        throw new Error('Cookie schema requires a verified intermediate migration before Electron43.');
      }
      const columns = database.prepare('PRAGMA table_info(cookies)').all().map(row => row.name);
      if (columns.length !== COOKIE_COLUMNS.length || COOKIE_COLUMNS.some((name, index) => columns[index] !== name)) {
        throw new Error('Unrecognized cookie table schema.');
      }
      const integrity = database.prepare('PRAGMA quick_check').all();
      if (integrity.length !== 1 || integrity[0]?.quick_check !== 'ok') {
        throw new Error('Cookie database integrity check failed.');
      }
    } finally { database.close(); }
  } catch (cause) {
    throw new Error(`Gnosi stopped before opening Chromium to protect cookies at ${filename}. Keep the profile intact and use a verified migration from the previous Gnosi version; do not delete Cookies or change its version metadata.`, { cause });
  }
}

/** Check default and persistent-partition cookie stores without opening a session.
 * @param {string} profile
 */
function assertProfileCookiesCompatible(profile) {
  if (!path.isAbsolute(profile)) throw new Error('Cookie profile paths must be absolute.');
  /** @param {string} directory */
  const checkDirectory = directory => {
    const stat = existing(directory);
    if (!stat) return;
    if (!stat.isDirectory()) throw new Error('Cookie profile must be a directory.');
    assertCookieDatabaseCompatible(path.join(directory, 'Cookies'));
    const network = path.join(directory, 'Network');
    const networkStat = existing(network);
    if (networkStat && !networkStat.isDirectory()) throw new Error('Cookie Network path must be a directory.');
    if (networkStat) assertCookieDatabaseCompatible(path.join(network, 'Cookies'));
  };
  checkDirectory(profile);
  const partitions = path.join(profile, 'Partitions');
  const stat = existing(partitions);
  if (!stat) return;
  if (!stat.isDirectory()) throw new Error('Cookie Partitions path must be a directory.');
  for (const name of fs.readdirSync(partitions)) {
    const directory = path.join(partitions, name);
    if (existing(directory)?.isDirectory()) checkDirectory(directory);
  }
}

module.exports = { assertCookieDatabaseCompatible, assertProfileCookiesCompatible };

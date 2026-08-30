// @ts-check
// Synthetic fixture only: independent Chromium19..24 layouts, no filesystem IO.
/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('node:sqlite').SQLInputValue} SQLInputValue */

/** @param {DatabaseSync} db @param {number} version @returns {void} */
function createSchema(db, version) {
  if (![19, 20, 21, 22, 23, 24].includes(version)) throw new Error('Unsupported fixture version.');
  db.exec(`CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR);
    CREATE TABLE cookies(creation_utc INTEGER NOT NULL,host_key TEXT NOT NULL,top_frame_site_key TEXT NOT NULL,
    name TEXT NOT NULL,value TEXT NOT NULL,encrypted_value BLOB NOT NULL,path TEXT NOT NULL,
    expires_utc INTEGER NOT NULL,is_secure INTEGER NOT NULL,is_httponly INTEGER NOT NULL,
    last_access_utc INTEGER NOT NULL,has_expires INTEGER NOT NULL,is_persistent INTEGER NOT NULL,
    priority INTEGER NOT NULL,samesite INTEGER NOT NULL,source_scheme INTEGER NOT NULL,
    source_port INTEGER NOT NULL,${version <= 20 ? 'is_same_party INTEGER NOT NULL,' : ''}
    last_update_utc INTEGER NOT NULL${version >= 22 ? ',source_type INTEGER NOT NULL' : ''}
    ${version >= 23 ? ',has_cross_site_ancestor INTEGER NOT NULL' : ''});
    CREATE UNIQUE INDEX cookies_unique_index ON cookies(host_key,top_frame_site_key,
    ${version >= 23 ? 'has_cross_site_ancestor,' : ''}name,path${version >= 20 ? ',source_scheme,source_port' : ''});`);
  const meta = db.prepare('INSERT INTO meta(key,value) VALUES(?,?)');
  meta.run('version', String(version));
  meta.run('last_compatible_version', String(version));
  meta.run('mmap_status', '-1');
}

/** Insert one synthetic row; integer defaults use BigInt, metadata uses strings.
 * Overrides must name fields actually present in this fixture's schema.
 * @param {DatabaseSync} db @param {Record<string, SQLInputValue>} [overrides]
 * @returns {void}
 */
function insertCookie(db, overrides = {}) {
  /** @type {Record<string, SQLInputValue>} */
  const defaults = {
    creation_utc: 13370000000000001n, host_key: '.fixture.invalid',
    top_frame_site_key: '', name: 'synthetic', value: 'synthetic-value',
    encrypted_value: Buffer.alloc(0), path: '/', expires_utc: 13380000000000003n,
    is_secure: 1n, is_httponly: 1n, last_access_utc: 13370000000000005n,
    has_expires: 1n, is_persistent: 1n, priority: 1n, samesite: -1n,
    source_scheme: 0n, source_port: 443n, is_same_party: 1n,
    last_update_utc: 13370000000000007n, source_type: 0n, has_cross_site_ancestor: 1n,
  };
  const columns = db.prepare('PRAGMA table_info(cookies)').all().map(row => {
    if (typeof row.name !== 'string' || !Object.hasOwn(defaults, row.name)) throw new Error('Invalid fixture schema.');
    return row.name;
  });
  if (Object.keys(overrides).some(name => !columns.includes(name))) throw new Error('Unknown fixture field.');
  const values = { ...defaults, ...overrides };
  db.prepare(`INSERT INTO cookies(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`)
    .run(...columns.map(name => {
      const value = values[name];
      if (value === undefined) throw new Error('Missing fixture field.');
      return value;
    }));
}

module.exports = { createSchema, insertCookie };

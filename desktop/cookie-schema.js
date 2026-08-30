// @ts-check
// Adapted Chromium schema definitions and migration expressions:
// Copyright 2012 The Chromium Authors
// Copyright 2015 The Chromium Authors
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//    * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//    * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//    * Neither the name of Google LLC nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
const { createHash } = require('node:crypto');

/** @typedef {import('node:sqlite').DatabaseSync} DatabaseSync */
/** @typedef {import('node:sqlite').SQLOutputValue} SQLValue */
/** @typedef {{ name: string, type: string }} Column */
/** @typedef {{ version: number, rowCount: number, encryptedRows: number }} CookieInspection */

// Structural definitions and composed 19->23 transformations adapted from
// Chromium (BSD-3-Clause), CreateV20/21/22/23Schema and DoMigrateDatabaseSchema:
// https://chromium.googlesource.com/chromium/src/+/refs/tags/142.0.7444.52/net/extras/sqlite/sqlite_persistent_cookie_store.cc
// Version 19 is also checked against the synthetic Electron28 SQLite schema.
// Never perform Chromium's 23->24 encryption migration here.
const TARGET_COLUMNS = Object.freeze([
  'creation_utc', 'host_key', 'top_frame_site_key', 'name', 'value',
  'encrypted_value', 'path', 'expires_utc', 'is_secure', 'is_httponly',
  'last_access_utc', 'has_expires', 'is_persistent', 'priority', 'samesite',
  'source_scheme', 'source_port', 'last_update_utc', 'source_type',
  'has_cross_site_ancestor',
]);
const TEXT_COLUMNS = new Set(['host_key', 'top_frame_site_key', 'name', 'value', 'path']);
const META_SQL = 'CREATE TABLE meta(key LONGVARCHAR NOT NULL UNIQUE PRIMARY KEY, value LONGVARCHAR)';

/** @param {number} version @returns {Column[]} */
function columnsFor(version) {
  const names = TARGET_COLUMNS.filter(name =>
    (version >= 22 || name !== 'source_type') &&
    (version >= 23 || name !== 'has_cross_site_ancestor'));
  if (version <= 20) names.splice(names.indexOf('last_update_utc'), 0, 'is_same_party');
  return names.map(name => ({
    name,
    type: TEXT_COLUMNS.has(name) ? 'TEXT' : name === 'encrypted_value' ? 'BLOB' : 'INTEGER',
  }));
}

/** @param {number} version @returns {string[]} */
function keyFor(version) {
  const keys = ['host_key', 'top_frame_site_key'];
  if (version >= 23) keys.push('has_cross_site_ancestor');
  keys.push('name', 'path');
  if (version >= 20) keys.push('source_scheme', 'source_port');
  return keys;
}

/** @param {number} version @returns {string} */
function tableSQL(version) {
  return `CREATE TABLE cookies(${columnsFor(version).map(column =>
    `${column.name} ${column.type} NOT NULL`).join(',')})`;
}

/** @param {number} version @returns {string} */
function indexSQL(version) {
  return `CREATE UNIQUE INDEX cookies_unique_index ON cookies(${keyFor(version).join(',')})`;
}

/** Only canonical Chromium DDL is accepted, ignoring whitespace/case/terminal ;.
 * This additionally excludes CHECK, foreign keys, generated columns, collations,
 * conflict policies and STRICT/WITHOUT ROWID not captured by table_info alone.
 * @param {SQLValue | undefined} actual @param {string} expected @returns {boolean}
 */
function sameDDL(actual, expected) {
  /** @param {string} sql */
  const normalize = sql => sql.replace(/\s+/g, '').replace(/;$/, '').toUpperCase();
  return typeof actual === 'string' && normalize(actual) === normalize(expected);
}

/** @param {boolean} condition @returns {asserts condition} */
function requireSchema(condition) {
  if (!condition) throw new Error('Unrecognized cookie database schema or metadata.');
}

/** @param {DatabaseSync} db @param {string} name @param {Column[]} expected */
function inspectColumns(db, name, expected) {
  // Names are internal constants, never supplied by database contents.
  const rows = db.prepare(`PRAGMA main.table_xinfo(${name})`).all();
  requireSchema(rows.length === expected.length);
  expected.forEach((column, index) => {
    const row = rows[index];
    requireSchema(row !== undefined && row.cid === index &&
      row.name === column.name && row.type === column.type &&
      row.notnull === (name === 'meta' && index === 1 ? 0 : 1) &&
      row.dflt_value === null && row.hidden === 0 &&
      row.pk === (name === 'meta' && index === 0 ? 1 : 0));
  });
}

/** @param {DatabaseSync} db @param {string} table @param {string} index
 * @param {string[]} keys @param {Column[]} columns @param {string} origin
 */
function inspectIndex(db, table, index, keys, columns, origin) {
  const indices = db.prepare(`PRAGMA main.index_list(${table})`).all();
  const definition = indices[0];
  requireSchema(indices.length === 1 && definition !== undefined &&
    definition.name === index && definition.unique === 1 &&
    definition.origin === origin && definition.partial === 0);
  const rows = db.prepare(`PRAGMA main.index_xinfo(${index})`).all();
  requireSchema(rows.length === keys.length + 1);
  keys.forEach((name, position) => {
    const row = rows[position];
    requireSchema(row !== undefined && row.seqno === position &&
      row.cid === columns.findIndex(column => column.name === name) &&
      row.name === name && row.desc === 0 && row.coll === 'BINARY' && row.key === 1);
  });
  const rowid = rows[keys.length];
  requireSchema(rowid !== undefined && rowid.seqno === keys.length &&
    rowid.cid === -1 && rowid.name === null && rowid.desc === 0 &&
    rowid.coll === 'BINARY' && rowid.key === 0);
}

/** @param {SQLValue | undefined} value @returns {number} */
function exactCount(value) {
  requireSchema(typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER));
  return Number(value);
}

/** Validate a known Chromium 19..24 fingerprint without writing anything.
 * encryptedRows counts opaque nonempty encrypted_value blobs; accepting their
 * encryption format/fuse is the caller's responsibility, not this SQL layer's.
 * @param {DatabaseSync} db @returns {CookieInspection}
 */
function inspectCookieSchema(db) {
  requireSchema(db.prepare('PRAGMA database_list').all().every(row =>
    row.name === 'main' || row.name === 'temp'));
  requireSchema(db.prepare('SELECT name FROM sqlite_temp_schema').all().length === 0);
  const objects = db.prepare('SELECT type,name,tbl_name,sql FROM main.sqlite_schema').all();
  requireSchema(objects.length === 4);
  const meta = objects.find(row => row.name === 'meta');
  const cookies = objects.find(row => row.name === 'cookies');
  const metaIndex = objects.find(row => row.name === 'sqlite_autoindex_meta_1');
  const cookieIndex = objects.find(row => row.name === 'cookies_unique_index');
  requireSchema(meta?.type === 'table' && meta.tbl_name === 'meta' && sameDDL(meta.sql, META_SQL));
  requireSchema(cookies?.type === 'table' && cookies.tbl_name === 'cookies');
  requireSchema(metaIndex?.type === 'index' && metaIndex.tbl_name === 'meta' && metaIndex.sql === null);
  requireSchema(cookieIndex?.type === 'index' && cookieIndex.tbl_name === 'cookies');
  const metaColumns = [{ name: 'key', type: 'LONGVARCHAR' }, { name: 'value', type: 'LONGVARCHAR' }];
  inspectColumns(db, 'meta', metaColumns);
  inspectIndex(db, 'meta', 'sqlite_autoindex_meta_1', ['key'], metaColumns, 'pk');
  // Compare complete bytes: node:sqlite TEXT decoding may truncate embedded NUL.
  const versions = db.prepare(`SELECT hex(CAST(value AS BLOB)) AS value, typeof(value) AS storage FROM main.meta
    WHERE key IN ('version', 'last_compatible_version') ORDER BY key`).all();
  requireSchema(versions.length === 2 && versions.every(row => row.storage === 'text'));
  const versionHex = versions[0]?.value;
  const supported = [19, 20, 21, 22, 23, 24];
  const version = supported.find(value => Buffer.from(String(value)).toString('hex').toUpperCase() === versionHex);
  requireSchema(version !== undefined && versions[1]?.value === versionHex);
  requireSchema(sameDDL(cookies.sql, tableSQL(version)) && sameDDL(cookieIndex.sql, indexSQL(version)));
  inspectColumns(db, 'cookies', columnsFor(version));
  inspectIndex(db, 'cookies', 'cookies_unique_index', keyFor(version), columnsFor(version), 'c');
  const statement = db.prepare(`SELECT COUNT(*) AS row_count,
    COALESCE(SUM(CASE WHEN length(CAST(encrypted_value AS BLOB)) > 0 THEN 1 ELSE 0 END), 0) AS encrypted_rows
    FROM main.cookies`);
  statement.setReadBigInts(true);
  const counts = statement.get();
  return { version, rowCount: exactCount(counts?.row_count), encryptedRows: exactCount(counts?.encrypted_rows) };
}

/** Compose upstream migrations in SQL, retaining SQLite's exact numeric/text
 * semantics, including the intentionally substring-based ancestor calculation.
 * @param {number} version @returns {string}
 */
function projectionSQL(version) {
  return TARGET_COLUMNS.map(name => {
    if (version < 22 && name === 'source_type') return '0 AS source_type';
    if (version < 23 && name === 'source_scheme') {
      return 'CASE WHEN source_scheme = 0 AND is_secure = 1 THEN 2 ELSE source_scheme END AS source_scheme';
    }
    if (version < 23 && name === 'has_cross_site_ancestor') {
      return `CASE WHEN INSTR(top_frame_site_key, '://') > 0 AND host_key
        LIKE CONCAT('%', SUBSTR(top_frame_site_key, INSTR(top_frame_site_key, '://') + 3), '%')
        THEN 0 ELSE 1 END AS has_cross_site_ancestor`;
    }
    return name;
  }).join(',');
}

/** Hash complete rows projected to schema23, without rowid or retired same_party.
 * Every field has an explicit name and SQLite storage-class tag. TEXT is fetched
 * as bytes to preserve NUL/Unicode/invalid UTF-8; BLOB never passes through text.
 * INTEGER is read as BigInt; REAL uses its exact IEEE754 bytes. Canonical ASCII
 * row serialization is sorted independently of insertion order and SQLite keys.
 * @param {DatabaseSync} db @returns {string}
 */
function cookieProjectionDigest(db) {
  const { version } = inspectCookieSchema(db);
  const fields = TARGET_COLUMNS.map(name =>
    `typeof(${name}) AS ${name}_type, CASE WHEN typeof(${name}) = 'text'
      THEN CAST(${name} AS BLOB) ELSE ${name} END AS ${name}`);
  const statement = db.prepare(`WITH projected AS (SELECT ${projectionSQL(version)} FROM main.cookies)
    SELECT ${fields.join(',')} FROM projected`);
  statement.setReadBigInts(true);
  const serialized = statement.all().map(row => JSON.stringify(TARGET_COLUMNS.map(name => {
    const type = row[`${name}_type`];
    const value = row[name];
    if ((type === 'text' || type === 'blob') && value instanceof Uint8Array) {
      return [name, type, Buffer.from(value).toString('hex')];
    }
    if (type === 'integer' && typeof value === 'bigint') return [name, type, value.toString()];
    if (type === 'real' && typeof value === 'number') {
      const bytes = Buffer.alloc(8);
      bytes.writeDoubleBE(value);
      return [name, type, bytes.toString('hex')];
    }
    if (type === 'null' && value === null) return [name, type, null];
    throw new Error('Unsupported SQLite cookie field representation.');
  })));
  serialized.sort();
  const hash = createHash('sha256');
  hash.update('gnosi-cookie-projection23-v1\n');
  for (const row of serialized) hash.update(row).update('\n');
  return hash.digest('hex');
}

/** Structurally migrate 19..22 to23; 23/24 are validated no-ops. Requires an
 * active caller-owned transaction, including on no-op calls. Never opens a DB,
 * begins/commits/rolls back, decrypts, or copies values through JavaScript.
 * On ANY error the caller MUST roll back before reuse; a normalization collision
 * deliberately uses INSERT's ABORT behavior, never replacement or dropped rows.
 * The caller owns the immutable original backup (including retired same_party),
 * before/after digest verification, integrity checking and final commit.
 * @param {DatabaseSync} db @returns {void}
 */
function migrateCookieSchema(db) {
  if (db.isTransaction !== true) throw new Error('Cookie migration requires an active caller transaction.');
  const before = inspectCookieSchema(db);
  if (before.version >= 23) return;
  db.exec('ALTER TABLE main.cookies RENAME TO cookies_old; DROP INDEX main.cookies_unique_index');
  db.exec(tableSQL(23));
  db.exec(indexSQL(23));
  db.exec(`INSERT INTO main.cookies (${TARGET_COLUMNS.join(',')})
    SELECT ${projectionSQL(before.version)} FROM main.cookies_old ORDER BY creation_utc ASC`);
  db.exec('DROP TABLE main.cookies_old');
  db.prepare("UPDATE main.meta SET value = ? WHERE key IN ('version', 'last_compatible_version')").run('23');
  const after = inspectCookieSchema(db);
  if (after.rowCount !== before.rowCount || after.encryptedRows !== before.encryptedRows) {
    throw new Error('Cookie migration row counts changed; caller must roll back.');
  }
}

module.exports = { inspectCookieSchema, migrateCookieSchema, cookieProjectionDigest };

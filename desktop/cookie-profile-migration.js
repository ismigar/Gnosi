// @ts-check
const { profileCookieStores, assertCookieDatabaseCompatible } = require('./cookie-schema-guard');
const { preflightCookieStore, migrateCookieStore } = require('./cookie-migration');

/** Prepare every cookie store before Chromium can remove an old schema.
 * @param {Iterable<string>} profiles
 */
function migrateProfileCookies(profiles) {
  const stores = [...new Set([...profiles].flatMap(profile => profileCookieStores(profile)))];
  for (const filename of stores) preflightCookieStore(filename);
  for (const filename of stores) migrateCookieStore(filename);
  for (const filename of stores) assertCookieDatabaseCompatible(filename);
}

module.exports = { migrateProfileCookies };

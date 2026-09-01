// @ts-check

const { createRequire } = require('node:module');

// Reuse the updater's locked parser without relying on pnpm hoisting. This
// module is packaged with the runtime, where electron-updater already exists.
const updaterRequire = createRequire(require.resolve('electron-updater/package.json'));
/** @type {{parse: (value: string) => {raw: string} | null}} */
const semver = updaterRequire('semver');

/**
 * Accept an exact SemVer spelling, including prerelease and build metadata.
 * semver.parse also accepts a leading `v`, so require a canonical digit first.
 * @param {unknown} value
 * @returns {value is string}
 */
function isCanonicalReleaseVersion(value) {
  if (typeof value !== 'string' || value.trim() !== value || !/^\d/.test(value)) return false;
  const parsed = semver.parse(value);
  return parsed !== null && parsed.raw === value;
}

module.exports = { isCanonicalReleaseVersion };

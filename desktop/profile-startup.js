// @ts-check
const os = require('node:os');
const path = require('node:path');
const { preserveLegacyProfile } = require('./profile-preservation');
const { assertProfileCookiesCompatible } = require('./cookie-schema-guard');
const { migrateProfileCookies } = require('./cookie-profile-migration');

/**
 * Normalize an environment path exactly where the packaged Python child starts.
 * @param {string} value
 * @param {string} cwd
 * @param {string} home
 */
function resolveDataPath(value, cwd, home) {
  if (value === '~') return home;
  if (/^~[\\/]/.test(value)) return path.resolve(home, value.slice(2));
  if (value.startsWith('~')) throw new Error('Use an absolute GNOSI_DATA_DIR for a different user home before upgrading Electron.');
  return path.resolve(cwd, value);
}

/**
 * Must run synchronously, before ready and before updater/session creation.
 * Keep the 2.x runtime profile name despite the pnpm package scope rename.
 * @param {Pick<Electron.App, 'isReady' | 'getName' | 'setName' | 'requestSingleInstanceLock' | 'getPath'>} app
 * @param {NodeJS.ProcessEnv} environment
 * @param {{backendCwd?: string, home?: string, preserve?: typeof preserveLegacyProfile, checkCookies?: typeof assertProfileCookiesCompatible}} [options]
 * @returns {boolean} False means another instance owns the profile; exit now.
 */
function prepareDesktopProfile(app, environment, options = {}) {
  if (app.isReady()) throw new Error('Desktop profile protection must run before Electron is ready.');
  if (app.getName() === '@gnosi/desktop') app.setName('gnosi');
  if (!app.requestSingleInstanceLock()) return false;
  const cwd = options.backendCwd ?? path.resolve(__dirname, '..');
  const home = options.home ?? os.homedir();
  const protectedDataPaths = [environment.GNOSI_DATA_DIR, environment.GNOSI_LOCAL_DATA, environment.LOCAL_DATA_DIR]
    .flatMap(value => value ? [resolveDataPath(value, cwd, home)] : []);
  const preserve = options.preserve ?? preserveLegacyProfile;
  const profiles = new Set([app.getPath('userData'), app.getPath('sessionData')]);
  const checkCookies = options.checkCookies;
  // Validate every profile before any move; Chromium must never open an old schema.
  if (checkCookies) for (const profile of profiles) checkCookies(profile);
  else if (Number(process.versions.electron?.split('.')[0]) >= 43) migrateProfileCookies(profiles);
  for (const profile of profiles) {
    preserve(profile, protectedDataPaths);
  }
  return true;
}

module.exports = { prepareDesktopProfile };

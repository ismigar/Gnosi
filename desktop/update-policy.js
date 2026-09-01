const { isCanonicalReleaseVersion } = require('./release-version');

const RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/ismigar/Gnosi/releases/download';

const SUPPORTED_MAC_ARCHITECTURES = new Set(['arm64', 'x64']);

/** @param {NodeJS.Platform} [platform] @returns {'manual' | 'automatic'} */
function getUpdateInstallMode(platform = process.platform) {
  return platform === 'darwin' ? 'manual' : 'automatic';
}

/**
 * @param {string} version
 * @param {string} [architecture]
 * @returns {string}
 */
function buildMacInstallerUrl(version, architecture = process.arch) {
  if (!isCanonicalReleaseVersion(version)) {
    throw new Error('Cannot build an update URL for an invalid version');
  }

  if (!SUPPORTED_MAC_ARCHITECTURES.has(architecture)) {
    throw new Error(`Unsupported macOS architecture: ${architecture}`);
  }

  return `${RELEASE_DOWNLOAD_BASE_URL}/v${version}/Gnosi-${version}-${architecture}.dmg`;
}

module.exports = {
  buildMacInstallerUrl,
  getUpdateInstallMode,
};

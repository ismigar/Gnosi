const { isCanonicalReleaseVersion } = require('./release-version');
const { spawnSync } = require('node:child_process');

const RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/ismigar/Gnosi/releases/download';

const SUPPORTED_MAC_ARCHITECTURES = new Set(['arm64', 'x64']);

/**
 * Squirrel verifies the installed and incoming signatures itself. Only offer
 * its flow for a Developer ID build, never for our ad-hoc development bundles.
 * @param {NodeJS.Platform} [platform]
 * @param {string} [signature]
 * @returns {'manual' | 'automatic'}
 */
function getUpdateInstallMode(platform = process.platform, signature = '') {
  if (platform !== 'darwin') return 'automatic';
  return /^Authority=Developer ID Application: .+$/m.test(signature)
    && /^TeamIdentifier=[A-Z0-9]{10}$/m.test(signature)
    && !/^Signature=adhoc$/m.test(signature) ? 'automatic' : 'manual';
}

/** @param {string} executable @returns {string} */
function readMacSignature(executable) {
  const result = spawnSync('/usr/bin/codesign', ['--display', '--verbose=4', executable], {
    encoding: 'utf8', timeout: 5000,
  });
  return result.status === 0 ? result.stderr : '';
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
  readMacSignature,
};

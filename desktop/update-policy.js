const RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/ismigar/Gnosi/releases/download';

const SUPPORTED_MAC_ARCHITECTURES = new Set(['arm64', 'x64']);
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function getUpdateInstallMode(platform = process.platform) {
  return platform === 'darwin' ? 'manual' : 'automatic';
}

function buildMacInstallerUrl(version, architecture = process.arch) {
  if (!SEMVER_PATTERN.test(version)) {
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

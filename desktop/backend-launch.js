// @ts-check

const path = require('node:path');

/**
 * Locate the bundled backend executable without accessing the filesystem.
 * @param {string} resourcesPath
 * @param {NodeJS.Platform} platform
 * @returns {string}
 */
function getPackagedBackendExecutable(resourcesPath, platform) {
  const executableName = platform === 'win32' ? 'cervell_backend.exe' : 'cervell_backend';
  return path.join(resourcesPath, 'python', executableName);
}

/**
 * Copy the inherited environment, selecting the first nonempty data override
 * in Python's order: GNOSI_DATA_DIR, GNOSI_LOCAL_DATA, then LOCAL_DATA_DIR.
 * Preserve path strings and existing aliases; never mutate the input.
 * @param {NodeJS.ProcessEnv} baseEnvironment
 * @param {string} userDataPath
 * @param {number} backendPort
 * @returns {NodeJS.ProcessEnv}
 */
function getPackagedBackendEnvironment(baseEnvironment, userDataPath, backendPort) {
  const dataDirectory =
    baseEnvironment.GNOSI_DATA_DIR ||
    baseEnvironment.GNOSI_LOCAL_DATA ||
    baseEnvironment.LOCAL_DATA_DIR ||
    userDataPath;
  return {
    ...baseEnvironment,
    GNOSI_DATA_DIR: dataDirectory,
    // Compatibility alias for third-party extensions throughout Gnosi 3.x.
    GNOSI_LOCAL_DATA: baseEnvironment.GNOSI_LOCAL_DATA || dataDirectory,
    BACKEND_PORT: String(backendPort),
    LOGGING_LEVEL: 'info',
  };
}

module.exports = { getPackagedBackendEnvironment, getPackagedBackendExecutable };

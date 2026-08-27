const path = require('node:path');

function getPackagedBackendExecutable(resourcesPath, platform) {
  const executableName = platform === 'win32' ? 'cervell_backend.exe' : 'cervell_backend';
  return path.join(resourcesPath, 'python', executableName);
}

function getPackagedBackendEnvironment(baseEnvironment, userDataPath, backendPort) {
  const dataDirectory =
    baseEnvironment.GNOSI_DATA_DIR ||
    baseEnvironment.GNOSI_LOCAL_DATA ||
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

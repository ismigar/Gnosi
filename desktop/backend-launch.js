const path = require('node:path');

function getPackagedBackendExecutable(resourcesPath, platform) {
  const executableName = platform === 'win32' ? 'cervell_backend.exe' : 'cervell_backend';
  return path.join(resourcesPath, 'python', executableName);
}

function getPackagedBackendEnvironment(baseEnvironment, userDataPath, backendPort) {
  return {
    ...baseEnvironment,
    GNOSI_LOCAL_DATA:
      baseEnvironment.GNOSI_LOCAL_DATA || path.join(userDataPath, 'local_data'),
    BACKEND_PORT: String(backendPort),
    LOGGING_LEVEL: 'info',
  };
}

module.exports = { getPackagedBackendEnvironment, getPackagedBackendExecutable };

// @ts-check

const { assertTrustedIpcSender } = require('./ipc-security');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.prototype.toString.call(value) === '[object Object]';
}

/** @param {unknown[]} args @returns {[]} */
function readEmptyArgs(...args) {
  if (args.length !== 0) throw new TypeError('Unexpected IPC arguments');
  return [];
}

/**
 * Omitted labels retain main's locale/default fallback. Normalization and
 * translated menu construction stay in main; supplied values must be strings.
 * @param {unknown[]} args
 * @returns {import('./ipc-contract').DesktopRequestArgs<'set-application-menu'>}
 */
function readMenuArgs(...args) {
  if (args.length > 1) throw new TypeError('Unexpected menu arguments');
  const payload = args[0];
  if (payload === undefined) return [];
  if (!isRecord(payload)) throw new TypeError('Invalid menu payload');
  const labels = payload.labels;
  if (labels === undefined) return [{}];
  if (!isRecord(labels)) throw new TypeError('Invalid menu labels');
  /** @type {Record<string, string>} */
  const decoded = {};
  for (const [key, value] of Object.entries(labels)) {
    if (typeof value !== 'string') throw new TypeError('Invalid menu label');
    Object.defineProperty(decoded, key, { value, enumerable: true });
  }
  return [{ labels: decoded }];
}

/** @param {unknown} error @returns {string} */
function errorMessage(error) {
  // Errors from another JS realm do not satisfy the local instanceof Error.
  if (typeof error === 'object' && error !== null && 'message' in error
    && typeof error.message === 'string') return error.message;
  return 'Unknown update error';
}

/**
 * Register the seven extracted handlers once during setupIPC. The existing
 * open-form-filler handler remains in main.
 * Every implementation is linked to its exact channel arguments and result.
 * All mutable state and native capabilities remain owned by the caller.
 * @param {import('./ipc-contract').DesktopIpcDependencies} dependencies
 * @returns {void}
 */
function registerIpcHandlers(dependencies) {
  /** @type {Omit<import('./ipc-contract').DesktopRequestHandlers, 'open-form-filler'>} */
  const handlers = {
    'get-app-version': () => dependencies.getAppVersion(),
    'set-application-menu': (payload = {}) => {
      dependencies.installApplicationMenu(payload.labels);
      return true;
    },
    'get-update-status': () => dependencies.getUpdateState(),
    'get-backend-url': () => dependencies.getBackendURL(),
    'get-backend-status': () => dependencies.getBackendStatus(),
    'download-update': async () => {
      if (dependencies.getUpdateState().status !== 'available') return dependencies.getUpdateState();
      dependencies.publishUpdateState({ userInitiated: true, error: undefined });
      try {
        const state = dependencies.getUpdateState();
        if (state.installMode === 'manual') {
          await dependencies.openExternal(dependencies.buildMacInstallerUrl(state.version));
          dependencies.publishUpdateState({ status: 'manual-download' });
        } else {
          await dependencies.downloadUpdate();
        }
      } catch (error) {
        const message = errorMessage(error);
        dependencies.log('Update download action failed:', message);
        dependencies.publishUpdateState({ status: 'error', error: message });
      }
      return dependencies.getUpdateState();
    },
    'install-update': () => {
      const state = dependencies.getUpdateState();
      if (state.status !== 'downloaded' || state.installMode !== 'automatic') return state;
      dependencies.publishUpdateState({ userInitiated: true, error: undefined });
      try {
        dependencies.quitAndInstall();
      } catch (error) {
        const message = errorMessage(error);
        dependencies.log('Update installation failed:', message);
        dependencies.publishUpdateState({ status: 'error', error: message });
      }
      return dependencies.getUpdateState();
    },
  };

  /**
   * Guard before decoding (even before payload getters), then pass a validated
   * tuple to the checked implementation. Electron's broad types stop here.
   * @template {keyof typeof handlers} K
   * @param {K} channel
   * @param {(...args: unknown[]) => import('./ipc-contract').DesktopRequestArgs<K>} decode
   * @returns {void}
   */
  function handle(channel, decode) {
    /**
     * @param {Electron.IpcMainInvokeEvent} event
     * @param {unknown[]} args
     */
    function listener(event, ...args) {
      assertTrustedIpcSender(event, dependencies.mainWindows, dependencies.isDev);
      return handlers[channel](...decode(...args));
    }
    dependencies.ipcMain.handle(channel, listener);
  }

  handle('get-app-version', readEmptyArgs);
  handle('set-application-menu', readMenuArgs);
  handle('get-update-status', readEmptyArgs);
  handle('get-backend-url', readEmptyArgs);
  handle('download-update', readEmptyArgs);
  handle('get-backend-status', readEmptyArgs);
  handle('install-update', readEmptyArgs);
}

module.exports = { registerIpcHandlers };

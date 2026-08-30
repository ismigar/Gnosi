const { contextBridge, ipcRenderer } = require('electron');

/** @typedef {import('./ipc-contract').DesktopUpdateState} DesktopUpdateState */
/** @typedef {import('./ipc-contract').DesktopRequestChannel} DesktopRequestChannel */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is DesktopUpdateState} */
function isUpdateState(value) {
  if (!isRecord(value)) return false;
  return typeof value.status === 'string'
    && ['idle', 'checking', 'not-available', 'available', 'downloading',
      'downloaded', 'manual-download', 'error'].includes(value.status)
    && (value.installMode === undefined || value.installMode === 'manual' || value.installMode === 'automatic')
    && (value.percent === undefined || (typeof value.percent === 'number' && Number.isFinite(value.percent)))
    && (value.version === undefined || typeof value.version === 'string')
    && (value.error === undefined || typeof value.error === 'string')
    && (value.userInitiated === undefined || typeof value.userInitiated === 'boolean');
}

/** @param {unknown} value @returns {DesktopUpdateState} */
function readUpdateState(value) {
  if (!isUpdateState(value)) throw new TypeError('Invalid desktop update state');
  return value;
}

/** @param {unknown} value @returns {string} */
function readString(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid desktop string response');
  return value;
}

/** @param {unknown} value @returns {boolean} */
function readBoolean(value) {
  if (typeof value !== 'boolean') throw new TypeError('Invalid desktop boolean response');
  return value;
}

/** @param {unknown} value @returns {import('./ipc-contract').BackendStatus} */
function readBackendStatus(value) {
  if (!isRecord(value) || typeof value.running !== 'boolean') {
    throw new TypeError('Invalid desktop backend status');
  }
  return { running: value.running };
}

/** @param {unknown} value @returns {void} */
function readVoid(value) {
  if (value !== undefined) throw new TypeError('Unexpected desktop response');
}

/**
 * Decode responses at the untyped Electron boundary. No generic IPC function
 * is exposed to the renderer, and transport rejections remain rejections.
 * @template T
 * @param {DesktopRequestChannel} channel
 * @param {(value: unknown) => T} decode
 * @param {unknown[]} args
 * @returns {Promise<T>}
 */
async function invoke(channel, decode, ...args) {
  /** @type {unknown} */
  const value = await ipcRenderer.invoke(channel, ...args);
  return decode(value);
}

/**
 * @param {'open-settings' | 'update-status'} channel
 * @param {(_event: Electron.IpcRendererEvent, payload: unknown) => void} listener
 * @returns {import('./ipc-contract').DesktopSubscription}
 */
function subscribe(channel, listener) {
  ipcRenderer.on(channel, listener);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    ipcRenderer.removeListener(channel, listener);
  };
}

/** @type {import('./ipc-contract').GnosiElectronApi} */
const electronAPI = {
  getAppVersion: () => invoke('get-app-version', readString),
  getBackendStatus: () => invoke('get-backend-status', readBackendStatus),
  // Backend base URL for the collaboration WebSocket (see main.js IPC). HTTP
  // calls stay relative and go through the `app://` proxy handler.
  getBackendURL: () => invoke('get-backend-url', readString),
  getUpdateStatus: () => invoke('get-update-status', readUpdateState),
  downloadUpdate: () => invoke('download-update', readUpdateState),
  installUpdate: () => invoke('install-update', readUpdateState),
  setApplicationMenu: (labels) => invoke('set-application-menu', readBoolean, { labels }),
  openFormFiller: (url, profile) => invoke('open-form-filler', readVoid, { url, profile }),
  
  onUpdateStatus: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Expected an update callback');
    return subscribe('update-status', (_event, data) => callback(readUpdateState(data)));
  },
  
  removeUpdateListener: () => {
    ipcRenderer.removeAllListeners('update-status');
  },

  onOpenSettings: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('Expected a settings callback');
    return subscribe('open-settings', () => callback());
  },

  removeOpenSettingsListener: () => {
    ipcRenderer.removeAllListeners('open-settings');
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  // Backend base URL for the collaboration WebSocket (see main.js IPC). HTTP
  // calls stay relative and go through the `app://` proxy handler.
  getBackendURL: () => ipcRenderer.invoke('get-backend-url'),
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  setApplicationMenu: (labels) => ipcRenderer.invoke('set-application-menu', { labels }),
  openFormFiller: (url, profile) => ipcRenderer.invoke('open-form-filler', { url, profile }),
  
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data));
  },
  
  removeUpdateListener: () => {
    ipcRenderer.removeAllListeners('update-status');
  },

  onOpenSettings: (callback) => {
    ipcRenderer.on('open-settings', callback);
  },

  removeOpenSettingsListener: () => {
    ipcRenderer.removeAllListeners('open-settings');
  },
});

console.log('Preload script loaded');

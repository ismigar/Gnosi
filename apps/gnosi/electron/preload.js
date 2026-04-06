const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getBackendStatus: () => ipcRenderer.invoke('get-backend-status'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (event, data) => callback(data));
  },
  
  removeUpdateListener: () => {
    ipcRenderer.removeAllListeners('update-status');
  }
});

console.log('Preload script loaded');

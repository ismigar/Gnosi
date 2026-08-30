const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** Load the actual main module with all operational effects replaced by test doubles. */
function loadMainRuntime({ isDev = false } = {}) {
  const desktopRoot = path.dirname(__dirname);
  const calls = [];
  const handlers = new Map();
  const protocols = new Map();
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: '', detached: false },
        isDestroyed: () => this.destroyed,
        setWindowOpenHandler: (handler) => { this.openHandler = handler; },
        openDevTools: () => calls.push('devtools'),
        executeJavaScript: async (script) => { calls.push({ script }); },
        send: (channel, payload) => calls.push({ channel, payload }),
        isLoading: () => false,
      });
      windows.push(this);
      calls.push('window-created');
    }
    isDestroyed() { return this.destroyed; }
    loadURL(url) {
      this.webContents.mainFrame = { url, detached: false };
      calls.push({ loadURL: url });
      return Promise.resolve();
    }
    show() {}
    focus() {}
    static getFocusedWindow() { return null; }
  }
  const electron = {
    app: {
      whenReady: () => ({ then: () => {} }),
      on: () => {},
      getVersion: () => { calls.push('version'); return '3.0.0-rc.1'; },
    },
    BrowserWindow,
    ipcMain: {
      handle: (channel, handler) => {
        assert.ok(!handlers.has(channel), `Duplicate handler: ${channel}`);
        handlers.set(channel, handler);
      },
    },
    Menu: {
      buildFromTemplate: (template) => template,
      setApplicationMenu: () => calls.push('menu-installed'),
    },
    protocol: {
      registerSchemesAsPrivileged: () => {},
      handle: (scheme, handler) => protocols.set(scheme, handler),
    },
    net: { fetch: async (url, init) => {
      calls.push({ backendUrl: url, method: init.method });
      return new Response('{"status":"ok"}', { headers: { 'content-type': 'application/json' } });
    } },
    shell: { openExternal: async (url) => { calls.push({ external: url }); } },
  };
  const updater = {
    downloadUpdate: async () => { calls.push('download'); },
    quitAndInstall: () => calls.push('install'),
    checkForUpdates: async () => { calls.push('check-updates'); },
  };
  const http = {
    get: (url, callback) => {
      calls.push({ healthUrl: url });
      callback({ statusCode: 200 });
      return { on() {}, setTimeout() {}, destroy() {} };
    },
  };
  const source = fs.readFileSync(path.join(desktopRoot, 'main.js'), 'utf8');
  const api = vm.runInNewContext(`${source}\n;({setupIPC, createWindow, registerAppProtocol, mainWindows, setUpdateState(value) { updateState = value; }})`, {
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === 'electron-updater') return { autoUpdater: updater };
      if (name === 'http') return http;
      if (name === 'child_process') return { spawn: () => assert.fail('Backend must not start in this fixture') };
      if (name === 'path') return path;
      if (name === 'fs') return fs;
      if (['./application-menu', './backend-launch', './update-policy', './ipc-security'].includes(name)) {
        return require(path.join(desktopRoot, name));
      }
      throw new Error(`Unexpected main-process dependency: ${name}`);
    },
    process: { argv: isDev ? ['--dev'] : [], platform: 'darwin', resourcesPath: '/fixture/resources', on() {} },
    __dirname: desktopRoot,
    console: { log: (...args) => calls.push({ log: args }) },
    URL, Headers, Response, setTimeout,
  }, { filename: 'main.js' });
  api.setupIPC();
  api.registerAppProtocol();
  return { ...api, calls, handlers, protocols, windows, BrowserWindow };
}

function senderEvent(window, frame = window.webContents.mainFrame) {
  return { sender: window.webContents, senderFrame: frame };
}

module.exports = { loadMainRuntime, senderEvent };

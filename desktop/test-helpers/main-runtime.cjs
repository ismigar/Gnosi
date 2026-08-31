const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** Load the actual main module with all operational effects replaced by test doubles. */
function loadMainRuntime({
  isDev = false, prepareProfile = () => true, initialize = true, bundleExists = false,
  launchBackend = () => assert.fail('Backend must not start in this fixture'),
  stopBackend = async () => {},
  locale = 'en', resourcesPath = '/fixture/resources',
} = {}) {
  const desktopRoot = path.dirname(__dirname);
  const calls = [];
  const handlers = new Map();
  const protocols = new Map();
  const windows = [];
  const readyCallbacks = [];
  const exits = [];
  const lifecycle = new Map();
  let menu = [];
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
    show() { calls.push('window-shown'); }
    focus() {}
    static getFocusedWindow() { return null; }
  }
  const electron = {
    app: {
      whenReady: () => ({ then: callback => { readyCallbacks.push(callback); } }),
      on: (event, callback) => lifecycle.set(event, callback),
      exit: code => exits.push(code),
      quit: () => calls.push('quit'),
      getPath: () => '/fixture/user-data',
      getLocale: () => locale,
      getVersion: () => { calls.push('version'); return '3.0.0-rc.1'; },
    },
    BrowserWindow,
    dialog: { showErrorBox: (title, message) => calls.push({ errorBox: { title, message } }) },
    ipcMain: {
      handle: (channel, handler) => {
        assert.ok(!handlers.has(channel), `Duplicate handler: ${channel}`);
        handlers.set(channel, handler);
      },
    },
    Menu: {
      buildFromTemplate: (template) => template,
      setApplicationMenu: template => { menu = template; calls.push('menu-installed'); },
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
    on: () => {},
  };
  const http = {
    get: (url, callback) => {
      calls.push({ healthUrl: url });
      callback({ statusCode: 200 });
      return { on() {}, setTimeout() {}, destroy() {} };
    },
  };
  const source = fs.readFileSync(path.join(desktopRoot, 'main.js'), 'utf8');
  const api = vm.runInNewContext(`${source}\n;({setupIPC, createWindow, registerAppProtocol, mainWindows, startBackend, getBackendStatus, setUpdateState(value) { updateState = value; }})`, {
    require: (name) => {
      if (name === 'electron') return electron;
      if (name === './profile-startup') return { prepareDesktopProfile: prepareProfile };
      if (name === './backend-process') return { launchBackend, stopBackend };
      if (name === 'electron-updater') return { autoUpdater: updater };
      if (name === 'electron-log') return { transports: { file: { level: 'info' } } };
      if (name === 'http') return http;
      if (name === 'child_process') return { spawn: () => assert.fail('Backend must not start in this fixture') };
      if (name === 'path') return path;
      if (name === 'fs') return {
        ...fs,
        existsSync: file => file.startsWith('/fixture/resources/python/') ? bundleExists : fs.existsSync(file),
        statSync: file => file.startsWith('/fixture/resources/python/')
          ? { isFile: () => bundleExists } : fs.statSync(file),
      };
      if (['./application-menu', './backend-launch', './update-policy', './ipc-security', './ipc-handlers', './startup-errors'].includes(name)) {
        return require(path.join(desktopRoot, name));
      }
      throw new Error(`Unexpected main-process dependency: ${name}`);
    },
    process: { argv: isDev ? ['--dev'] : [], platform: 'darwin', resourcesPath, env: {}, on() {} },
    __dirname: desktopRoot,
    console: { log: (...args) => calls.push({ log: args }) },
    URL, Headers, Response, setTimeout,
  }, { filename: 'main.js' });
  if (initialize) {
    api.setupIPC();
    api.registerAppProtocol();
  }
  return { ...api, calls, handlers, protocols, windows, BrowserWindow, readyCallbacks, exits, lifecycle,
    clickMenu(label) {
      const item = menu.flatMap(group => group.submenu || []).find(item => item.label === label);
      assert.equal(typeof item?.click, 'function', `Missing menu action: ${label}`);
      return item.click();
    },
  };
}

function senderEvent(window, frame = window.webContents.mainFrame) {
  return { sender: window.webContents, senderFrame: frame };
}

module.exports = { loadMainRuntime, senderEvent };

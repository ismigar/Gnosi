const { app, BrowserWindow, ipcMain, Menu, protocol, net, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { launchBackend, stopBackend } = require('./backend-process');
const { prepareDesktopProfile } = require('./profile-startup');

// Protect the 2.x profile before the updater or any Chromium session can open it.
let startupAllowed = false;
try {
  startupAllowed = prepareDesktopProfile(app, process.env);
  if (!startupAllowed) app.exit(0);
} catch (error) {
  try {
    dialog.showErrorBox('Gnosi — profile protection', String(error?.message || error));
  } finally {
    app.exit(1);
  }
}

const { autoUpdater } = require('electron-updater');
const { createApplicationMenuTemplate, normalizeMenuLabels } = require('./application-menu');
const {
  getPackagedBackendEnvironment,
  getPackagedBackendExecutable,
} = require('./backend-launch');
const { buildMacInstallerUrl, getUpdateInstallMode } = require('./update-policy');
const { isTrustedRendererUrl } = require('./ipc-security');
const { registerIpcHandlers } = require('./ipc-handlers');
const { backendStartupMessage } = require('./startup-errors');

const isDev = process.argv.includes('--dev');

// Register the `app://` privileged scheme before app ready. The packaged
// frontend is served from this scheme (see registerAppProtocol + createWindow),
// so it keeps a stable, non-`file://` origin. Relative `fetch('/api/...')`
// calls then resolve to `app://gnosi/api/...` and are proxied to the local
// backend by the handler below. `supportFetchAPI` + `stream` are required for
// fetch and large upload/download bodies to work from the scheme.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);

const mainWindows = new Set();
let backendProcess = null;
let backendHandle = null;
let backendReady = false;
let quitting = false;
let updateState = { status: 'idle', installMode: getUpdateInstallMode() };

const BACKEND_PORT = 5002;
const FRONTEND_PORT = 5173;
const DOCUMENTATION_URL = 'https://gnosi.temenosismael.org/engineering/';

function log(...args) {
  console.log(`[Main]`, new Date().toISOString(), ...args);
}

function publishUpdateState(nextState) {
  updateState = { ...updateState, ...nextState };
  for (const window of mainWindows) {
    if (!window.isDestroyed()) {
      window.webContents.send('update-status', updateState);
    }
  }
}

function getBackendURL() {
  return `http://localhost:${BACKEND_PORT}`;
}

// MIME types for the static asset handler. Covers everything Vite emits under
// `frontend/dist`; falls back to `application/octet-stream`.
const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function mimeFor(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

// Resolves an `app://gnosi/<path>` request to a file under `frontend/dist`.
// `gnosi` is the scheme host, so the pathname already starts at the asset root
// (e.g. `/assets/index.js`, `/favicon.svg`). SPA fallback: extensionless or
// missing paths return index.html so BrowserRouter can handle them.
function resolveAssetPath(urlStr) {
  let urlPath = '/';
  try {
    urlPath = decodeURIComponent(new URL(urlStr).pathname);
  } catch {
    urlPath = '/';
  }
  const segments = urlPath.split('/').filter(Boolean);
  const distRoot = path.join(process.resourcesPath, 'frontend', 'dist');
  const relPath = segments.join('/');
  const absPath = path.resolve(distRoot, relPath || 'index.html');

  // Prevent path traversal outside distRoot.
  if (!absPath.startsWith(distRoot + path.sep) && absPath !== distRoot) {
    return path.join(distRoot, 'index.html');
  }
  // Files with an extension are served if present; extensionless paths fall
  // back to the SPA entry (BrowserRouter history routing).
  if (path.extname(absPath) && fs.existsSync(absPath) && fs.statSync(absPath).isFile()) {
    return absPath;
  }
  return path.join(distRoot, 'index.html');
}

// Registers `app://` as the origin for the packaged frontend. Requests under
// `/api` are proxied to the local backend over the main-process session (so
// the `gnosi_session` cookie jar is shared automatically); everything else is
// served from `frontend/dist` with SPA fallback.
function registerAppProtocol() {
  protocol.handle('app', async (request) => {
    if (!isTrustedRendererUrl(request.url, false)) {
      return new Response('Forbidden application origin', { status: 403 });
    }
    const url = new URL(request.url);
    const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');

    if (isApi) {
      // Build the backend URL from scratch. We CANNOT use `new URL(request.url,
      // getBackendURL())` because request.url is absolute (scheme `app://`), so
      // the base argument is ignored and net.fetch would re-enter this handler
      // → infinite loop. Reconstruct explicitly from pathname + search.
      const backendUrl = `${getBackendURL()}${url.pathname}${url.search}`;
      // Strip origin/host headers: net.fetch must set them for the backend
      // (the renderer's `app://gnosi` values would confuse it). Cookies are
      // managed by the defaultSession jar, not forwarded by header here.
      const forwardHeaders = new Headers(request.headers);
      for (const h of ['host', 'origin', 'referer', 'cookie', 'content-length']) {
        forwardHeaders.delete(h);
      }
      const init = {
        method: request.method,
        headers: forwardHeaders,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'follow',
        duplex: 'half',
      };
      // net.fetch shares the defaultSession cookie jar, so the `gnosi_session`
      // cookie set by the backend on login is sent automatically.
      const upstream = await net.fetch(backendUrl, init);
      // Copy the response but drop hop-by-hop headers that don't belong on the
      // proxied reply (transfer-encoding is regenerated by Electron).
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete('transfer-encoding');
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    // Static asset from frontend/dist.
    const filePath = resolveAssetPath(request.url);
    try {
      const data = await fs.promises.readFile(filePath);
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': mimeFor(filePath) },
      });
    } catch (err) {
      log('Asset not found:', filePath, err.message);
      return new Response(`Not found: ${path.basename(filePath)}`, {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  });
}

async function startBackend() {
  log('Starting backend...');
  const bundled = getPackagedBackendExecutable(process.resourcesPath, process.platform);
  if (!isDev && (!fs.existsSync(bundled) || !fs.statSync(bundled).isFile())) {
    throw Object.assign(new Error('The packaged backend is missing'), { code: 'GNOSI_BACKEND_MISSING' });
  }
  const environment = isDev
    ? { ...process.env, LOGGING_LEVEL: 'info' }
    : getPackagedBackendEnvironment(process.env, app.getPath('userData'), BACKEND_PORT);
  backendHandle = await launchBackend({
    executable: isDev ? (process.platform === 'win32' ? 'python' : 'python3') : bundled,
    args: isDev ? ['-m', 'uvicorn', 'backend.server:app', '--host', '127.0.0.1',
      '--port', String(BACKEND_PORT)] : [],
    cwd: path.join(__dirname, '..'),
    environment,
    healthUrl: `${getBackendURL()}/api/health`,
    onSpawn: child => {
      backendProcess = child;
      child.once('exit', () => { backendReady = false; });
    },
    onOutput: output => log('Backend:', output.trim()),
  });
  backendReady = true;
}

async function getBackendStatus() {
  return { running: backendReady && !quitting && backendHandle ? await backendHandle.isRunning() : false };
}

function getPreferredMainWindow() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && mainWindows.has(focusedWindow) && !focusedWindow.isDestroyed()) {
    return focusedWindow;
  }
  return Array.from(mainWindows).reverse().find((window) => !window.isDestroyed()) || null;
}

function canUseMainWindows() {
  return startupAllowed && backendReady && !quitting;
}

function openMainWindow() {
  return canUseMainWindows() ? createWindow() : null;
}

function sendToMainWindow(channel, payload) {
  if (!canUseMainWindows()) return;
  const window = getPreferredMainWindow() || openMainWindow();
  if (!window) return;
  const send = () => {
    if (canUseMainWindows() && !window.isDestroyed()) {
      window.show();
      window.focus();
      window.webContents.send(channel, payload);
    }
  };

  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

function checkForUpdatesFromMenu() {
  if (!canUseMainWindows()) return;
  publishUpdateState({ status: 'checking', userInitiated: true, error: undefined });
  autoUpdater.checkForUpdates().catch((err) => {
    log('Manual update check failed:', err.message);
    publishUpdateState({ status: 'error', userInitiated: true, error: err.message });
  });
}

function installApplicationMenu(labels) {
  const template = createApplicationMenuTemplate({
    labels: normalizeMenuLabels(labels),
    isDev,
    onCheckForUpdates: checkForUpdatesFromMenu,
    onNewWindow: openMainWindow,
    onOpenDocumentation: () => {
      void shell.openExternal(DOCUMENTATION_URL).catch((err) => {
        log('Failed to open documentation:', err.message);
      });
    },
    onOpenSettings: () => sendToMainWindow('open-settings'),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: 'Gnosi',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    show: false,
    backgroundColor: '#f8fafc'
  });
  mainWindows.add(window);
  
  if (isDev) {
    window.loadURL(`http://localhost:${FRONTEND_PORT}`);
    window.webContents.openDevTools();
  } else {
    // Load from the `app://` scheme so the packaged frontend shares a stable
    // origin and `/api/...` requests are proxied to the backend by the handler
    // registered in registerAppProtocol().
    window.loadURL('app://gnosi/index.html');
  }
  
  window.once('ready-to-show', () => {
    if (!canUseMainWindows()) return;
    window.show();
    if (isDev) {
      window.webContents.openDevTools();
    }
  });
  
  window.on('closed', () => {
    mainWindows.delete(window);
  });

  // A trusted window must not retain its preload bridge after remote navigation.
  const preventUntrustedNavigation = (event, url) => {
    if (!isTrustedRendererUrl(url, isDev)) event.preventDefault();
  };
  window.webContents.on('will-navigate', preventUntrustedNavigation);
  window.webContents.on('will-redirect', preventUntrustedNavigation);
  
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      void shell.openExternal(url).catch((err) => {
        log('Failed to open external URL:', err.message);
      });
    }
    return { action: 'deny' };
  });

  window.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log('Failed to load:', errorCode, errorDescription);
  });

  return window;
}

function setupAutoUpdater() {
  if (isDev) {
    log('Auto-updater disabled in dev mode');
    return;
  }
  
  autoUpdater.logger = require('electron-log');
  autoUpdater.logger.transports.file.level = 'info';
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    log('Checking for update...');
    publishUpdateState({ status: 'checking' });
  });
  
  autoUpdater.on('update-available', (info) => {
    log('Update available:', info.version);
    publishUpdateState({
      status: 'available',
      version: info.version,
      installMode: getUpdateInstallMode(),
      userInitiated: false,
      error: undefined,
    });
  });
  
  autoUpdater.on('update-not-available', () => {
    log('Update not available');
    publishUpdateState({ status: 'not-available' });
  });
  
  autoUpdater.on('error', (err) => {
    log('Auto-updater error:', err.message);
    publishUpdateState({ status: 'error', error: err.message });
  });
  
  autoUpdater.on('download-progress', (progress) => {
    publishUpdateState({
      status: 'downloading', 
      percent: progress.percent 
    });
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    log('Update downloaded:', info.version);
    publishUpdateState({ status: 'downloaded', version: info.version });
  });
  
  autoUpdater.checkForUpdates().catch((err) => {
    log('Initial update check failed:', err.message);
  });
}

function setupIPC() {
  registerIpcHandlers({
    ipcMain, mainWindows, isDev,
    getAppVersion: () => app.getVersion(),
    getBackendURL, getBackendStatus,
    getUpdateState: () => updateState,
    publishUpdateState, installApplicationMenu, buildMacInstallerUrl,
    openExternal: url => shell.openExternal(url),
    downloadUpdate: () => autoUpdater.downloadUpdate(),
    quitAndInstall: () => autoUpdater.quitAndInstall(),
    createFormFillerWindow: options => new BrowserWindow(options),
    log,
  });
}

if (startupAllowed) app.whenReady().then(async () => {
  if (quitting) return;
  log('App ready');

  // Replace Electron's English development menu immediately. The renderer
  // synchronizes translated labels after its configured interface language is
  // resolved.
  installApplicationMenu();
  setupIPC();

  // Register the `app://` scheme handler before any window loads from it.
  registerAppProtocol();

  try {
    await startBackend();
    if (quitting) return;
    log('Backend started');
  } catch (err) {
    if (quitting) return;
    log('Backend start failed:', err.message);
    startupAllowed = false;
    const message = backendStartupMessage(app.getLocale(), err);
    dialog.showErrorBox(message.title, message.message);
    app.quit();
    return;
  }

  openMainWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindows.size === 0) {
    openMainWindow();
  }
});

app.on('second-instance', () => {
  if (!canUseMainWindows()) return;
  const window = [...mainWindows].find(candidate => !candidate.isDestroyed());
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

app.on('before-quit', (event) => {
  if (quitting) return;
  quitting = true;
  backendReady = false;
  if (!backendProcess) return;
  event.preventDefault();
  stopBackend(backendProcess).catch(error => {
    log('Backend shutdown failed:', error.message);
  }).finally(() => app.quit());
});

process.on('uncaughtException', (error) => {
  log('Uncaught exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  log('Unhandled rejection:', reason);
});

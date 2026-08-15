const { app, BrowserWindow, ipcMain, Menu, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');
const { createApplicationMenuTemplate, normalizeMenuLabels } = require('./application-menu');
const { buildMacInstallerUrl, getUpdateInstallMode } = require('./update-policy');

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

function getPythonBundlePath() {
  if (process.platform === 'win32') {
    return path.join(process.resourcesPath, 'python', 'cervell_backend.exe');
  } else {
    return path.join(process.resourcesPath, 'python', 'cervell_backend');
  }
}

function getPythonSystemCmd() {
  if (process.platform === 'win32') {
    return 'python';
  } else if (process.platform === 'darwin') {
    return 'python3';
  } else {
    return 'python3';
  }
}

function waitForBackend(maxRetries = 60, interval = 2000) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    
    const check = () => {
      const http = require('http');
      const req = http.get(`${getBackendURL()}/api/system/stats`, (res) => {
        if (res.statusCode === 200) {
          log('Backend is ready!');
          resolve();
        } else {
          retry();
        }
      });
      
      req.on('error', () => {
        retry();
      });
    };
    
    const retry = () => {
      retries++;
      if (retries >= maxRetries) {
        log(`Backend not ready after ${maxRetries} retries, continuing anyway...`);
        resolve();
      } else {
        setTimeout(check, interval);
      }
    };
    
    check();
  });
}

async function startBackend() {
  log('Starting backend...');
  
  const pythonBundle = getPythonBundlePath();
  const bundleExists = fs.existsSync(pythonBundle);
  
  log(`Python bundle path: ${pythonBundle}`);
  log(`Bundle exists: ${bundleExists}`);
  
  if (!isDev && bundleExists) {
    log('Using Python bundle...');
    
    let pythonExe;
    if (process.platform === 'win32') {
      pythonExe = pythonBundle;
    } else {
      pythonExe = path.join(process.resourcesPath, 'python', 'cervell_backend', 'cervell_backend');
    }
    
    log(`Executable: ${pythonExe}`);
    
    return new Promise((resolve, reject) => {
      backendProcess = spawn(pythonExe, [], {
        cwd: path.join(__dirname, '..'),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          LOGGING_LEVEL: 'info',
          BACKEND_PORT: BACKEND_PORT.toString()
        },
        detached: false
      });
      
      let stderr = '';
      
      backendProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      backendProcess.stdout.on('data', (data) => {
        log('Backend stdout:', data.toString().trim());
      });
      
      backendProcess.on('error', (err) => {
        log('Backend spawn error:', err.message);
        reject(err);
      });
      
      backendProcess.on('exit', (code) => {
        if (code !== 0) {
          log(`Backend exited with code ${code}`);
          log('stderr:', stderr.substring(0, 500));
        }
      });
      
      waitForBackend()
        .then(resolve)
        .catch(reject);
    });
  } else {
    log('Using system Python...');
    
    const pythonCmd = getPythonSystemCmd();
    const args = [
      '-m', 'uvicorn',
      'backend.server:app',
      '--host', '127.0.0.1',
      '--port', BACKEND_PORT.toString()
    ];
    
    log(`Command: ${pythonCmd} ${args.join(' ')}`);
    
    return new Promise((resolve, reject) => {
      backendProcess = spawn(pythonCmd, args, {
        cwd: path.join(__dirname, '..'),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          LOGGING_LEVEL: 'info'
        }
      });
      
      let stderr = '';
      
      backendProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      backendProcess.stdout.on('data', (data) => {
        log('Backend stdout:', data.toString().trim());
      });
      
      backendProcess.on('error', (err) => {
        log('Backend spawn error:', err.message);
        reject(err);
      });
      
      backendProcess.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          log(`Backend exited with code ${code}`);
        }
      });
      
      waitForBackend()
        .then(resolve)
        .catch(reject);
    });
  }
}

function getPreferredMainWindow() {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (focusedWindow && mainWindows.has(focusedWindow) && !focusedWindow.isDestroyed()) {
    return focusedWindow;
  }
  return Array.from(mainWindows).reverse().find((window) => !window.isDestroyed()) || null;
}

function sendToMainWindow(channel, payload) {
  const window = getPreferredMainWindow() || createWindow();
  const send = () => {
    if (!window.isDestroyed()) {
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
    onNewWindow: createWindow,
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
    window.show();
    if (isDev) {
      window.webContents.openDevTools();
    }
  });
  
  window.on('closed', () => {
    mainWindows.delete(window);
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
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('set-application-menu', (event, { labels } = {}) => {
    installApplicationMenu(labels);
    return true;
  });

  ipcMain.handle('get-update-status', () => updateState);

  // Exposes the backend URL to the renderer so the collaboration WebSocket
  // (useCollaboration.js / collabProvider.js) can connect directly. HTTP calls
  // do NOT need this: they stay relative and are proxied by the `app://`
  // handler. Only WebSocket connections need the explicit host because the
  // `app://` protocol handler does not intercept `ws://` upgrades.
  ipcMain.handle('get-backend-url', () => getBackendURL());

  ipcMain.handle('download-update', async () => {
    if (updateState.status !== 'available') {
      return updateState;
    }

    publishUpdateState({ userInitiated: true, error: undefined });

    try {
      if (updateState.installMode === 'manual') {
        const installerUrl = buildMacInstallerUrl(updateState.version);
        await shell.openExternal(installerUrl);
        publishUpdateState({ status: 'manual-download' });
      } else {
        await autoUpdater.downloadUpdate();
      }
    } catch (err) {
      log('Update download action failed:', err.message);
      publishUpdateState({ status: 'error', error: err.message });
    }

    return updateState;
  });
  
  ipcMain.handle('get-backend-status', async () => {
    return new Promise((resolve) => {
      const http = require('http');
      const req = http.get(`${getBackendURL()}/api/system/stats`, (res) => {
        resolve({ running: res.statusCode === 200 });
      });
      req.on('error', () => resolve({ running: false }));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve({ running: false });
      });
    });
  });
  
  ipcMain.handle('install-update', () => {
    if (updateState.status !== 'downloaded' || updateState.installMode !== 'automatic') {
      return updateState;
    }

    publishUpdateState({ userInitiated: true, error: undefined });

    try {
      autoUpdater.quitAndInstall();
    } catch (err) {
      log('Update installation failed:', err.message);
      publishUpdateState({ status: 'error', error: err.message });
    }

    return updateState;
  });

  ipcMain.handle('open-form-filler', async (event, { url, profile }) => {
    log('Opening form filler for:', url);
    
    const fillerWin = new BrowserWindow({
      width: 1000,
      height: 800,
      title: 'Gnosi Form Filler',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    });

    fillerWin.loadURL(url);

    fillerWin.webContents.on('did-finish-load', () => {
      log('Form loaded, injecting script...');
      
      const script = `
        (function() {
          const profile = ${JSON.stringify(profile)};
          console.log('Gnosi: Starting autocomplete with profile', profile);
          
          const fields = {
            email: ['email', 'mail', 'correu', 'correo'],
            first_name: ['first_name', 'nombre', 'nom', 'given-name'],
            last_name: ['last_name', 'cognom', 'apellido', 'family-name'],
            full_name: ['full_name', 'name', 'nombre_completo', 'nom_complet'],
            phone: ['phone', 'tel', 'mobil', 'móvil', 'telefon'],
            address: ['address', 'adreça', 'direccion', 'dirección', 'street'],
            city: ['city', 'ciutat', 'poblacio', 'población'],
            zip_code: ['zip', 'postal', 'codi_postal', 'cp'],
            dni_nie: ['dni', 'nif', 'nie', 'document']
          };

          function fill() {
            const inputs = document.querySelectorAll('input, textarea, select');
            inputs.forEach(input => {
              const name = (input.name || '').toLowerCase();
              const id = (input.id || '').toLowerCase();
              const placeholder = (input.placeholder || '').toLowerCase();
              const label = input.labels && input.labels.length > 0 ? input.labels[0].innerText.toLowerCase() : '';
              
              for (const [key, patterns] of Object.entries(fields)) {
                if (profile[key] && patterns.some(p => name.includes(p) || id.includes(p) || placeholder.includes(p) || label.includes(p))) {
                  console.log('Gnosi: Filling field', key, 'into', name || id);
                  input.value = profile[key];
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                  break;
                }
              }
            });
          }

          // Run once and also observe for dynamic forms (like Google Forms sections)
          fill();
          setTimeout(fill, 1000);
          setTimeout(fill, 3000);
        })();
      `;

      fillerWin.webContents.executeJavaScript(script);
    });
  });
}

app.whenReady().then(async () => {
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
    log('Backend started');
  } catch (err) {
    log('Backend start failed:', err.message);
    log('Continuing without backend...');
  }

  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (backendProcess) {
      backendProcess.kill();
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindows.size === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

process.on('uncaughtException', (error) => {
  log('Uncaught exception:', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
  log('Unhandled rejection:', reason);
});

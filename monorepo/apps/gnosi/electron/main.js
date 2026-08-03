const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

const isDev = process.argv.includes('--dev');

let mainWindow;
let backendProcess = null;
let updateState = { status: 'idle' };

const BACKEND_PORT = 5002;
const FRONTEND_PORT = 5173;

function log(...args) {
  console.log(`[Main]`, new Date().toISOString(), ...args);
}

function getBackendURL() {
  return `http://localhost:${BACKEND_PORT}`;
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

function createWindow() {
  mainWindow = new BrowserWindow({
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
  
  if (isDev) {
    mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(process.resourcesPath, 'frontend/dist/index.html'));
  }
  
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    log('Failed to load:', errorCode, errorDescription);
  });
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

  const publishUpdateState = (nextState) => {
    updateState = { ...updateState, ...nextState };
    mainWindow?.webContents.send('update-status', updateState);
  };
  
  autoUpdater.on('checking-for-update', () => {
    log('Checking for update...');
    publishUpdateState({ status: 'checking' });
  });
  
  autoUpdater.on('update-available', (info) => {
    log('Update available:', info.version);
    publishUpdateState({ status: 'available', version: info.version });
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

  ipcMain.handle('get-update-status', () => updateState);

  ipcMain.handle('download-update', async () => {
    if (updateState.status !== 'available') {
      return updateState;
    }

    await autoUpdater.downloadUpdate();
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
    autoUpdater.quitAndInstall();
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
  
  try {
    await startBackend();
    log('Backend started');
  } catch (err) {
    log('Backend start failed:', err.message);
    log('Continuing without backend...');
  }
  
  createWindow();
  setupIPC();
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
  if (BrowserWindow.getAllWindows().length === 0) {
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

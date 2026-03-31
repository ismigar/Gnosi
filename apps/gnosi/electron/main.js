const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

const isDev = process.argv.includes('--dev');

let mainWindow;
let backendProcess = null;

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
    title: 'Cervell Digital',
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
    mainWindow.loadFile(path.join(__dirname, 'frontend/dist/index.html'));
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
  
  autoUpdater.on('checking-for-update', () => {
    log('Checking for update...');
  });
  
  autoUpdater.on('update-available', (info) => {
    log('Update available:', info.version);
    mainWindow?.webContents.send('update-status', { status: 'available', version: info.version });
  });
  
  autoUpdater.on('update-not-available', () => {
    log('Update not available');
    mainWindow?.webContents.send('update-status', { status: 'not-available' });
  });
  
  autoUpdater.on('error', (err) => {
    log('Auto-updater error:', err.message);
    mainWindow?.webContents.send('update-status', { status: 'error', error: err.message });
  });
  
  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update-status', { 
      status: 'downloading', 
      percent: progress.percent 
    });
  });
  
  autoUpdater.on('update-downloaded', (info) => {
    log('Update downloaded:', info.version);
    mainWindow?.webContents.send('update-status', { status: 'downloaded', version: info.version });
  });
  
  autoUpdater.checkForUpdatesAndNotify();
}

function setupIPC() {
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
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
  setupAutoUpdater();
  setupIPC();
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

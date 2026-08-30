/** Isolated real-Electron smoke test. Never imports main.js or starts a backend/updater. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, protocol, session } = require('electron');
const { assertTrustedIpcSender } = require('../ipc-security');

const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'gnosi-ipc-smoke-'));
for (const name of ['userData', 'sessionData', 'logs', 'crashDumps']) {
  const directory = path.join(artifacts, name);
  fs.mkdirSync(directory);
  app.setPath(name, directory);
}
const mainWindows = new Set();
const ownedWindows = new Set();
const version = '3.0.0-rc.1';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Gnosi isolated IPC verification</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'">
<style>body{font:18px system-ui;padding:32px;background:#f8fafc;color:#182234}h1{color:#334bca}li{margin:14px 0}button{padding:8px 16px}</style>
</head><body><h1>Gnosi desktop — isolated IPC</h1><ul>
<li id="version">Loading version</li><li id="settings">Settings event pending</li>
<li id="first">First update listener: 0</li><li id="second">Second update listener: 0</li>
<li id="isolation">Checking isolation</li></ul><button id="dispose">Dispose first listener</button>
<script src="app://gnosi/probe.js"></script></body></html>`;
const probe = `
document.getElementById('isolation').textContent = 'Node globals exposed: ' + (typeof require !== 'undefined' || typeof process !== 'undefined');
window.electronAPI.getAppVersion().then(version => {
  document.getElementById('version').textContent = 'Version: ' + version;
}).catch(() => { document.getElementById('version').textContent = 'Untrusted window: denied'; });
window.electronAPI.onOpenSettings((...args) => {
  document.getElementById('settings').textContent = 'Settings event arguments: ' + args.length;
});
let first = 0; let second = 0;
const dispose = window.electronAPI.onUpdateStatus(() => {
  document.getElementById('first').textContent = 'First update listener: ' + (++first);
});
window.electronAPI.onUpdateStatus(() => {
  document.getElementById('second').textContent = 'Second update listener: ' + (++second);
});
document.getElementById('dispose').onclick = () => { dispose(); dispose(); };
`;
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

async function waitForText(window, text) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const body = await window.webContents.executeJavaScript('document.body.innerText');
    if (body.includes(text)) return body;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`IPC smoke did not display: ${text}`);
}

async function createProbe(trusted) {
  const window = new BrowserWindow({
    show: false, width: 900, height: 560,
    webPreferences: {
      preload: path.resolve(__dirname, '../preload.js'),
      sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true,
    },
  });
  ownedWindows.add(window);
  if (trusted) mainWindows.add(window);
  await window.loadURL('app://gnosi/index.html');
  return window;
}

async function verify() {
  // Even unexpected renderer requests are unable to contact external services.
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('app://gnosi/') });
  });
  protocol.handle('app', request => {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/probe.js') return new Response(probe, { headers: { 'Content-Type': 'text/javascript' } });
    if (pathname === '/index.html') return new Response(html, { headers: { 'Content-Type': 'text/html' } });
    return new Response('Not found', { status: 404 });
  });
  ipcMain.handle('get-app-version', event => {
    assertTrustedIpcSender(event, mainWindows, false);
    return version;
  });
  const trusted = await createProbe(true);
  await waitForText(trusted, `Version: ${version}`);
  trusted.webContents.send('open-settings', { unexpected: 'must not reach callback' });
  await waitForText(trusted, 'Settings event arguments: 0');
  trusted.webContents.send('update-status', { status: 'available', version });
  await waitForText(trusted, 'Second update listener: 1');
  await trusted.webContents.executeJavaScript("document.getElementById('dispose').click()");
  trusted.webContents.send('update-status', { status: 'downloading', percent: 42 });
  const trustedText = await waitForText(trusted, 'Second update listener: 2');
  assert.ok(trustedText.includes('First update listener: 1'));
  assert.ok(trustedText.includes('Node globals exposed: false'));

  const foreign = await createProbe(false);
  const foreignText = await waitForText(foreign, 'Untrusted window: denied');
  assert.ok(foreignText.includes('Node globals exposed: false'));
  const screenshot = path.join(artifacts, 'trusted-window.png');
  fs.writeFileSync(screenshot, (await trusted.webContents.capturePage()).toPNG());
  const report = {
    electron: process.versions.electron, node: process.versions.node, architecture: process.arch,
    passed: true, artifacts, screenshot, trustedText, foreignText,
  };
  fs.writeFileSync(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  for (const window of ownedWindows) if (!window.isDestroyed()) window.destroy();
  app.exit(code);
}
const deadline = setTimeout(() => {
  process.stderr.write('Isolated IPC smoke exceeded its 30-second deadline\n');
  finish(1);
}, 30_000);
app.whenReady().then(verify).then(() => {
  clearTimeout(deadline);
  finish(0);
}).catch(error => {
  clearTimeout(deadline);
  process.stderr.write(`${error.stack || error}\nArtifacts: ${artifacts}\n`);
  finish(1);
});

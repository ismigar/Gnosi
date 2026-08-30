/** Child of smoke-profile.cjs. Synthetic profiles only; never imports production main. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, protocol, session } = require('electron');
const { prepareDesktopProfile } = require('../profile-startup');

let window;
let timer;
function finish(code, error) {
  clearTimeout(timer);
  if (error) process.stderr.write(`${error.stack || error}\n`);
  if (window && !window.isDestroyed()) window.destroy();
  app.exit(code);
}

async function verify(root, stage, profile, beforeName) {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('app://gnosi/') });
  });
  protocol.handle('app', () => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>Gnosi profile recovery test</title><style>body{font:20px system-ui;padding:40px;color:#182234;background:#f8fafc}h1{color:#334bca}p{margin:24px 0}</style>
    </head><body><h1>Gnosi — profile preservation</h1><p id="storage">Checking persisted browser data…</p>
    <p id="recovery">Checking legacy data…</p><p id="isolation"></p></body></html>`, { headers: { 'Content-Type': 'text/html' } }));
  window = new BrowserWindow({ show: false, width: 950, height: 460, webPreferences: {
    sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true,
  } });
  await window.loadURL('app://gnosi/profile');
  const key = 'gnosi:profile-smoke';
  const value = JSON.stringify({ draft: 'Synthetic mail draft', chat: ['Synthetic chat turn'] });
  if (stage === 'seed') {
    await window.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)})`);
    await session.defaultSession.cookies.set({ url: 'https://profile.invalid', name: 'gnosi-fixture', value: 'synthetic-cookie', expirationDate: Date.now() / 1000 + 86400 });
  }
  assert.equal(await window.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(key)})`), value);
  const cookies = await session.defaultSession.cookies.get({ url: 'https://profile.invalid', name: 'gnosi-fixture' });
  assert.equal(cookies[0]?.value, 'synthetic-cookie');
  session.defaultSession.flushStorageData();
  await session.defaultSession.cookies.flushStore();
  const original = path.join(profile, 'databases');
  const saved = path.join(path.dirname(profile), `.${path.basename(profile)}.gnosi-electron-recovery`, 'databases.saved');
  assert.equal(fs.readFileSync(path.join(stage === 'seed' ? original : saved, 'opaque.bin'), 'hex'), '00017f80feff');
  assert.equal(fs.readFileSync(path.join(profile, 'system', 'fixture-data.bin'), 'utf8'), 'Synthetic Gnosi data');
  if (stage !== 'seed') assert.equal(fs.existsSync(original), false);
  assert.equal(app.getName(), 'gnosi');
  assert.equal(app.getPath('userData'), profile);
  assert.equal(app.getPath('sessionData'), profile);
  await window.webContents.executeJavaScript(`
    document.getElementById('storage').textContent = 'Mail draft, chat and cookie: preserved';
    document.getElementById('recovery').textContent = ${JSON.stringify(stage === 'seed' ? 'Legacy fixture seeded' : 'Legacy directory saved; Gnosi data unchanged')};
    document.getElementById('isolation').textContent = 'Node globals exposed: ' + (typeof require !== 'undefined' || typeof process !== 'undefined');
  `);
  const text = await window.webContents.executeJavaScript('document.body.innerText');
  assert.ok(text.includes('Node globals exposed: false'));
  const screenshot = path.join(root, `${stage}.png`);
  fs.writeFileSync(screenshot, (await window.webContents.capturePage()).toPNG());
  const report = { stage, electron: process.versions.electron, beforeName, name: app.getName(), profile, passed: true, screenshot, text, mockKeychain: true };
  fs.writeFileSync(path.join(root, `${stage}.json`), JSON.stringify(report, null, 2));
}

try {
  const root = process.env.GNOSI_PROFILE_SMOKE_DIR;
  const stage = process.env.GNOSI_PROFILE_SMOKE_STAGE;
  assert.ok(root && path.isAbsolute(root) && path.basename(root).startsWith('gnosi-profile-smoke-'), 'Run through smoke-profile.cjs');
  assert.equal(fs.readFileSync(path.join(root, 'owned-fixture'), 'utf8'), 'Gnosi synthetic profile smoke v1');
  assert.ok(['seed', 'upgrade', 'repeat'].includes(stage));
  const profile = path.join(root, 'profile');
  for (const name of ['userData', 'sessionData', 'logs', 'crashDumps']) {
    const directory = ['userData', 'sessionData'].includes(name) ? profile : path.join(root, name);
    fs.mkdirSync(directory, { recursive: true });
    app.setPath(name, directory);
  }
  // Test-only encryption stores: never read or write the user's login keychain.
  // This tests cookie persistence, not production OS-secret-store compatibility.
  app.commandLine.appendSwitch('use-mock-keychain');
  app.commandLine.appendSwitch('password-store', 'basic');
  const beforeName = app.getName();
  if (stage === 'seed') {
    assert.ok(Number(process.versions.electron.split('.')[0]) < 32, 'Seed requires the previous Electron runtime (<32)');
    fs.mkdirSync(path.join(profile, 'databases'));
    fs.writeFileSync(path.join(profile, 'databases', 'opaque.bin'), Buffer.from([0, 1, 127, 128, 254, 255]));
    fs.mkdirSync(path.join(profile, 'system'));
    fs.writeFileSync(path.join(profile, 'system', 'fixture-data.bin'), 'Synthetic Gnosi data');
  } else {
    assert.equal(prepareDesktopProfile(app, {}), true);
    assert.equal(app.isReady(), false);
  }
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
  timer = setTimeout(() => finish(1, new Error('Profile probe exceeded 40 seconds')), 40_000);
  app.whenReady().then(() => verify(root, stage, profile, beforeName)).then(() => finish(0)).catch(error => finish(1, error));
} catch (error) { finish(1, error); }

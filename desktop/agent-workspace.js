const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);

/** Per-window task capabilities. Remote pages never receive the application preload. */
function createAgentWorkspace({ BrowserWindow, dialog, shell, selectionSecret, platform = process.platform, run = exec }) {
  const tasks = new Map();
  function key(owner, request) {
    if (!request || typeof request.agentId !== 'string' || typeof request.sessionId !== 'string'
      || !/^[\w.-]{1,128}$/.test(request.agentId) || !/^[\w.-]{1,128}$/.test(request.sessionId)
      || typeof request.scopeKey !== 'string' || !/^[a-f0-9]{64}$/.test(request.scopeKey)) {
      throw new Error('Invalid task identity');
    }
    return JSON.stringify([owner.webContents.id, request.scopeKey, request.agentId, request.sessionId]);
  }
  function state(owner, request) {
    const id = key(owner, request);
    let value = tasks.get(id);
    if (!value) {
      value = { browser: null, origin: null, appId: null, human: false, generation: 0, controller: new AbortController() };
      tasks.set(id, value);
      owner.once('closed', () => { value.controller.abort(); value.browser?.destroy(); tasks.delete(id); });
    }
    return value;
  }
  function url(value) {
    const result = new URL(value);
    if (!['https:', 'http:'].includes(result.protocol) || result.username || result.password) {
      throw new Error('Only web addresses without credentials are allowed');
    }
    return result;
  }
  function labels(request) {
    const source = request.labels || {};
    const get = (name, fallback) => typeof source[name] === 'string' ? source[name].slice(0, 500) : fallback;
    return { title: get('title', 'Gnosi'), allow: get('allow', 'Allow'), cancel: get('cancel', 'Cancel'),
      browser: get('browser', 'Allow the agent to use this website?'),
      application: get('application', 'Choose an application for this conversation'),
      type: get('type', 'Allow the agent to enter this text?'), folder: get('folder', 'Choose a shared folder') };
  }
  async function approve(owner, request, message, detail) {
    const text = labels(request);
    const response = await dialog.showMessageBox(owner, { type: 'question', title: text.title,
      message, detail: String(detail).slice(0, 8000), buttons: [text.allow, text.cancel],
      defaultId: 1, cancelId: 1, noLink: true });
    if (response.response !== 0) throw new Error('Access declined');
  }
  function browser(value) {
    if (!value.browser || value.browser.isDestroyed() || value.human) throw new Error('Browser access is inactive');
    const current = url(value.browser.webContents.getURL());
    if (current.origin !== value.origin) throw new Error('Browser origin changed');
    return value.browser;
  }
  async function operation(owner, request) {
    const value = state(owner, request);
    const text = labels(request);
    const invalidate = () => { value.generation += 1; value.controller.abort(); value.controller = new AbortController(); };
    if (request.action === 'browser-open' || request.action === 'app-open') invalidate();
    const generation = value.generation;
    const signal = value.controller.signal;
    const current = () => { if (tasks.get(key(owner, request)) !== value || value.generation !== generation || signal.aborted) throw new Error('Task access was revoked or changed'); };
    switch (request.action) {
      case 'pick-folder': {
        const selection = await dialog.showOpenDialog(owner, { title: text.folder, properties: ['openDirectory'] });
        current();
        if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
        const selectedPath = selection.filePaths[0];
        const body = Buffer.from(JSON.stringify({ path: selectedPath, agent_id: request.agentId,
          session_id: request.sessionId, scope_key: request.scopeKey, expires_at: Math.floor(Date.now() / 1000) + 90,
          nonce: crypto.randomUUID() })).toString('base64url');
        return { path: selectedPath, selection_token: `${body}.${crypto.createHmac('sha256', selectionSecret).update(body).digest('hex')}` };
      }
      case 'browser-open': {
        const target = url(request.url);
        await approve(owner, request, text.browser, target.origin);
        current();
        value.browser?.destroy();
        const win = new BrowserWindow({ width: 1100, height: 800, parent: owner, show: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true,
            partition: `gnosi-agent-${crypto.randomUUID()}` } });
        value.browser = win; value.origin = target.origin; value.human = false;
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        for (const eventName of ['will-navigate', 'will-redirect']) {
          win.webContents.on(eventName, (event, destination) => {
            try { if (url(destination).origin === value.origin) return; } catch { /* Deny invalid navigation. */ }
            event.preventDefault();
          });
        }
        win.on('closed', () => { if (value.browser === win) { value.browser = null; value.origin = null; } });
        await win.loadURL(target.href);
        current();
        return { status: 'opened', origin: target.origin };
      }
      case 'browser-snapshot': {
        const win = browser(value);
        const result = await win.webContents.executeJavaScript(`({url:location.href,title:document.title,text:document.body.innerText.slice(0,24000),controls:[...document.querySelectorAll('a,button,input,textarea,select')].slice(0,100).map(e=>({tag:e.tagName,label:(e.innerText||e.getAttribute('aria-label')||e.getAttribute('placeholder')||'').slice(0,160),id:e.id}))})`);
        current(); browser(value);
        return { status: 'observed', page: result };
      }
      case 'browser-click':
      case 'browser-type': {
        const win = browser(value);
        if (typeof request.selector !== 'string' || request.selector.length > 1000) throw new Error('Invalid selector');
        if (request.action === 'browser-type' && (typeof request.text !== 'string' || request.text.length > 16000)) throw new Error('Invalid text');
        await approve(owner, request, text.type, request.action === 'browser-type' ? request.text : request.selector);
        current();
        browser(value);
        // Renderer work is read-only: queued JavaScript cannot click or type
        // after a takeover. Only the main process dispatches input, after the
        // renderer reply and another check of the exact capability generation.
        const selector = JSON.stringify(request.selector);
        const target = await win.webContents.executeJavaScript(`(()=>{const e=document.querySelector(${selector});if(!e)throw Error('Element not found');const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0||r.top<0||r.left<0||r.bottom>innerHeight||r.right>innerWidth)throw Error('Element is not visible');return{x:r.left+r.width/2,y:r.top+r.height/2,editable:(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement)&&!e.disabled&&!e.readOnly&&!['password','file','hidden'].includes(e.type)}})()`);
        current(); browser(value);
        if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y)) throw new Error('Invalid browser target');
        if (request.action === 'browser-type' && target.editable !== true) throw new Error('Protected or noneditable field');
        win.focus(); win.webContents.focus();
        const position = { x: Math.round(target.x), y: Math.round(target.y), button: 'left', clickCount: 1 };
        win.webContents.sendInputEvent({ ...position, type: 'mouseDown' });
        win.webContents.sendInputEvent({ ...position, type: 'mouseUp' });
        if (request.action === 'browser-type') {
          win.webContents.selectAll();
          if (!request.text) {
            win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Backspace' });
            win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Backspace' });
          }
          let count = 0;
          for (const character of request.text) {
            current(); browser(value);
            win.webContents.sendInputEvent({ type: 'char', keyCode: character });
            if (++count % 32 === 0) await new Promise(resolve => setImmediate(resolve));
          }
        }
        current();
        return { status: 'completed' };
      }
      case 'browser-takeover':
        invalidate(); value.human = true; value.browser?.show(); value.browser?.focus();
        return { status: 'human_control' };
      case 'browser-stop':
        invalidate(); value.browser?.destroy(); value.browser = null; value.origin = null; value.human = true;
        return { status: 'stopped' };
      case 'app-open': {
        if (platform !== 'darwin') throw new Error('Native application control is available on macOS');
        const selection = await dialog.showOpenDialog(owner, { title: text.application, defaultPath: '/Applications',
          properties: ['openFile'], filters: [{ name: 'Applications', extensions: ['app'] }] });
        current();
        if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
        const selectedPath = selection.filePaths[0];
        if (!selectedPath.startsWith('/Applications/') || !selectedPath.endsWith('.app')) throw new Error('Choose an installed application');
        const { stdout } = await run('/usr/bin/defaults', ['read', `${selectedPath}/Contents/Info`, 'CFBundleIdentifier'], { timeout: 5000, maxBuffer: 4096, signal });
        const appId = stdout.trim();
        current();
        if (!/^[A-Za-z0-9.-]{3,200}$/.test(appId)) throw new Error('Invalid application identity');
        const error = await shell.openPath(selectedPath); current();
        if (error) throw new Error('Application could not be opened');
        value.appId = appId;
        return { status: 'opened', app_id: appId };
      }
      case 'app-type': {
        if (platform !== 'darwin' || !value.appId) throw new Error('Select an application first');
        const appId = value.appId;
        if (typeof request.text !== 'string' || !request.text || request.text.length > 8000) throw new Error('Invalid text');
        await approve(owner, request, text.type, `${appId}\n\n${request.text}`);
        current();
        const script = 'on run argv\nset bid to item 1 of argv\nset entryText to item 2 of argv\ntell application id bid to activate\ntell application "System Events"\nrepeat 20 times\nif bundle identifier of first application process whose frontmost is true is bid then exit repeat\ndelay 0.1\nend repeat\nif bundle identifier of first application process whose frontmost is true is not bid then error "Application focus changed"\nkeystroke entryText\nend tell\nend run';
        if (value.appId !== appId) throw new Error('Application access changed');
        await run('/usr/bin/osascript', ['-e', script, appId, request.text], { timeout: 10000, maxBuffer: 4096, signal });
        current();
        return { status: 'completed', app_id: appId };
      }
      case 'messages-compose': {
        if (platform !== 'darwin' || typeof request.text !== 'string' || request.text.length > 8000) throw new Error('Messages compose unavailable');
        await approve(owner, request, text.type, request.text);
        current();
        await shell.openExternal(`sms:&body=${encodeURIComponent(request.text)}`);
        return { status: 'draft_opened' };
      }
      case 'revoke':
        invalidate(); value.human = true; value.appId = null; value.browser?.destroy(); tasks.delete(key(owner, request));
        return { status: 'revoked' };
      default: throw new Error('Unknown workspace operation');
    }
  }
  return { operation };
}

module.exports = { createAgentWorkspace };

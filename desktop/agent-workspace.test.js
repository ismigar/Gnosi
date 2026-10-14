const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createAgentWorkspace } = require('./agent-workspace');

function fixture({ run, platform } = {}) {
  const windows = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.destroyed = false; this.address = '';
      this.webContents = new EventEmitter();
      this.webContents.session = { setPermissionRequestHandler: handler => { this.permissionHandler = handler; } };
      this.webContents.setWindowOpenHandler = handler => { this.popupHandler = handler; };
      this.webContents.getURL = () => this.address;
      this.webContents.executeJavaScript = async script => { this.lastScript = script; return { text: 'Synthetic page' }; };
      this.webContents.focus = () => {};
      this.webContents.selectAll = () => {};
      this.inputs = []; this.webContents.sendInputEvent = input => this.inputs.push(input);
      windows.push(this);
    }
    async loadURL(address) { this.address = address; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    show() {} focus() {}
  }
  const owner = new EventEmitter(); owner.webContents = { id: 1 };
  const dialog = { showMessageBox: async () => ({ response: 0 }),
    showOpenDialog: async () => ({ filePaths: ['/tmp/example-folder'], canceled: false }) };
  const shell = { openPath: async () => '', openExternal: async () => undefined };
  const manager = createAgentWorkspace({ BrowserWindow: Window, dialog, shell, selectionSecret: 'test-secret', run, platform });
  const operation = (action, data = {}) => manager.operation(owner, { agentId: 'principal', sessionId: 'conversation', scopeKey: 'a'.repeat(64), action, ...data });
  return { owner, dialog, windows, operation, manager };
}

test('native folder selection signs exact path/task and expires', async () => {
  const { operation } = fixture();
  const result = await operation('pick-folder');
  const [body, signature] = result.selection_token.split('.');
  assert.equal(signature, crypto.createHmac('sha256', 'test-secret').update(body).digest('hex'));
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  assert.equal(payload.path, result.path); assert.equal(payload.session_id, 'conversation');
  assert.equal(payload.scope_key, 'a'.repeat(64));
  assert.ok(payload.expires_at > Date.now() / 1000); assert.ok(payload.expires_at < Date.now() / 1000 + 120);
});

test('browser denies nonweb credentials and cross-origin navigation, isolates remote content', async () => {
  const { operation, windows } = fixture();
  await assert.rejects(operation('browser-open', { url: 'file:///etc/passwd' }));
  await assert.rejects(operation('browser-open', { url: 'https://user:password@example.org' }));
  await operation('browser-open', { url: 'https://example.org/page' });
  const win = windows[0];
  assert.equal(win.options.webPreferences.nodeIntegration, false);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.equal(win.options.webPreferences.preload, undefined);
  let blocked = false;
  win.webContents.emit('will-navigate', { preventDefault() { blocked = true; } }, 'https://other.org');
  assert.equal(blocked, true); assert.deepEqual(win.popupHandler(), { action: 'deny' });
  await operation('browser-takeover');
  await assert.rejects(operation('browser-snapshot'), /inactive/);
});

test('browser capabilities are scoped to the exact owner and conversation', async () => {
  const { operation, manager, owner } = fixture();
  await operation('browser-open', { url: 'https://example.org' });
  await assert.rejects(manager.operation(owner, { agentId: 'principal', sessionId: 'other', action: 'browser-snapshot' }));
  await assert.rejects(operation('browser-snapshot', { scopeKey: 'b'.repeat(64) }));
  owner.emit('closed');
  await assert.rejects(operation('browser-snapshot'));
});

test('revocation cancels a permission dialog that was already pending', async () => {
  const { operation, dialog, windows } = fixture();
  let settle;
  dialog.showMessageBox = () => new Promise(resolve => { settle = resolve; });
  const pending = operation('browser-open', { url: 'https://example.org' });
  await operation('revoke'); settle({ response: 0 });
  await assert.rejects(pending, /revoked/); assert.equal(windows.length, 0);
});

for (const interruption of ['browser-stop', 'browser-takeover']) {
  test(`${interruption} invalidates an older browser approval`, async () => {
    const { operation, dialog, windows } = fixture();
    let settle;
    dialog.showMessageBox = () => new Promise(resolve => { settle = resolve; });
    const pending = operation('browser-open', { url: 'https://example.org' });
    await operation(interruption); settle({ response: 0 });
    await assert.rejects(pending, /changed/); assert.equal(windows.length, 0);
    await assert.rejects(operation('browser-snapshot'));
  });
}

test('typing approval is bound to the application selected before its dialog', async () => {
  const calls = [];
  const { operation, dialog } = fixture({ platform: 'darwin', run: async (file, args) => {
    if (file.endsWith('defaults')) return { stdout: args[1].includes('A.app') ? 'com.example.A' : 'com.example.B' };
    calls.push(args); return { stdout: '' };
  } });
  dialog.showOpenDialog = async () => ({ filePaths: ['/Applications/A.app'], canceled: false });
  await operation('app-open');
  let settle;
  dialog.showMessageBox = () => new Promise(resolve => { settle = resolve; });
  const pending = operation('app-type', { text: 'Synthetic text' });
  dialog.showOpenDialog = async () => ({ filePaths: ['/Applications/B.app'], canceled: false });
  await operation('app-open'); settle({ response: 0 });
  await assert.rejects(pending, /changed/); assert.equal(calls.length, 0);
});

test('revocation aborts an in-flight native typing process', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const { operation, dialog } = fixture({ platform: 'darwin', run: async (file, _args, options) => {
    if (file.endsWith('defaults')) return { stdout: 'com.example.A' };
    started(); return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });
  } });
  dialog.showOpenDialog = async () => ({ filePaths: ['/Applications/A.app'], canceled: false });
  await operation('app-open');
  const pending = operation('app-type', { text: 'Synthetic text' });
  await ready; await operation('revoke'); await assert.rejects(pending, /Aborted/);
});

test('takeover invalidates queued browser discovery before native input is dispatched', async () => {
  const { operation, windows } = fixture();
  await operation('browser-open', { url: 'https://example.org' });
  let settle; let started;
  const ready = new Promise(resolve => { started = resolve; });
  windows[0].webContents.executeJavaScript = script => {
    assert.doesNotMatch(script, /\.click\(|\.focus\(|dispatchEvent|\.value\s*=/);
    started(); return new Promise(resolve => { settle = resolve; });
  };
  const pending = operation('browser-click', { selector: '#synthetic' });
  await ready; await operation('browser-takeover'); settle({ x: 10, y: 20, editable: true });
  await assert.rejects(pending, /changed/); assert.equal(windows[0].inputs.length, 0);
});

test('typing can be interrupted between bounded native input batches', async () => {
  const { operation, windows } = fixture();
  await operation('browser-open', { url: 'https://example.org' });
  windows[0].webContents.executeJavaScript = async () => ({ x: 10, y: 20, editable: true });
  let stop;
  const ready = new Promise(resolve => { stop = resolve; });
  windows[0].webContents.sendInputEvent = input => { windows[0].inputs.push(input); if (input.type === 'char') stop(); };
  const pending = operation('browser-type', { selector: '#synthetic', text: 'a'.repeat(200) });
  await ready; await operation('browser-takeover'); await assert.rejects(pending, /changed/);
  assert.ok(windows[0].inputs.filter(input => input.type === 'char').length <= 32);
});

test('a snapshot from before takeover cannot be returned after reopening the browser', async () => {
  const { operation, windows } = fixture();
  await operation('browser-open', { url: 'https://example.org/old' });
  let settle;
  windows[0].webContents.executeJavaScript = () => new Promise(resolve => { settle = resolve; });
  const pending = operation('browser-snapshot');
  await operation('browser-takeover');
  await operation('browser-open', { url: 'https://example.org/new' });
  settle({ url: 'https://example.org/old', text: 'Old page' });
  await assert.rejects(pending, /changed/);
});

test('empty browser typing clears an existing editable field with native deletion input', async () => {
  const { operation, windows } = fixture();
  await operation('browser-open', { url: 'https://example.org' });
  windows[0].webContents.executeJavaScript = async () => ({ x: 10, y: 10, editable: true });
  assert.deepEqual(await operation('browser-type', { selector: 'input', text: '' }), { status: 'completed' });
  assert.deepEqual(windows[0].inputs.slice(-2), [
    { type: 'keyDown', keyCode: 'Backspace' }, { type: 'keyUp', keyCode: 'Backspace' },
  ]);
});

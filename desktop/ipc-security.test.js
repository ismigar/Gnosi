// @ts-check

const assert = require('node:assert/strict');
const test = require('node:test');
const { isTrustedRendererUrl, assertTrustedIpcSender } = require('./ipc-security');

/** @typedef {{url: string, isDestroyed?: () => boolean, detached?: boolean}} FrameDouble */
/** @typedef {{id: number, isDestroyed: () => boolean, mainFrame: FrameDouble | null | undefined, getURL: () => string}} ContentsDouble */
/** @typedef {{isDestroyed: () => boolean, webContents: ContentsDouble}} WindowDouble */
/** @typedef {{sender: ContentsDouble, senderFrame: FrameDouble | null | undefined}} EventDouble */

/** @param {string} [url] */
function fixture(url = 'app://gnosi/index.html') {
  /** @type {FrameDouble} */
  const frame = { url };
  /** @type {ContentsDouble} */
  const sender = {
    id: 1,
    isDestroyed: () => false,
    mainFrame: frame,
    getURL: () => 'app://gnosi/index.html',
  };
  /** @type {WindowDouble} */
  const window = { isDestroyed: () => false, webContents: sender };
  /** @type {EventDouble} */
  const event = { sender, senderFrame: frame };
  return { frame, sender, window, event, windows: new Set([window]) };
}

/** @param {ReturnType<typeof fixture>} value @param {boolean} [isDev] */
function check(value, isDev = false) {
  // These doubles intentionally implement only the native surface read by the guard.
  assertTrustedIpcSender(
    /** @type {Parameters<typeof assertTrustedIpcSender>[0]} */ (/** @type {unknown} */ (value.event)),
    /** @type {Parameters<typeof assertTrustedIpcSender>[1]} */ (/** @type {unknown} */ (value.windows)),
    isDev,
  );
}

/** @param {ReturnType<typeof fixture>} value @param {boolean} [isDev] */
function reject(value, isDev = false) {
  assert.throws(() => check(value, isDev), (/** @type {unknown} */ error) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, 'Untrusted IPC sender');
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
}

for (const suffix of ['', '/', '/index.html', '/vault/notes%20one', '?view=graph',
  '#/settings', '/notes?id=42&next=https%3A%2F%2Fexample.invalid#section',
  '/@name:5173?email=fixture@example.invalid#app://other']) {
  test(`accepts trusted renderer paths, queries and hashes: ${suffix || '(root)'}`, () => {
    for (const isDev of [false, true]) {
      const url = `${isDev ? 'http://localhost:5173' : 'app://gnosi'}${suffix}`;
      assert.equal(isTrustedRendererUrl(url, isDev), true);
      assert.equal(check(fixture(url), isDev), undefined);
    }
  });
}

test('development and packaged authorities are mutually exclusive', () => {
  assert.equal(isTrustedRendererUrl('app://gnosi', true), false);
  assert.equal(isTrustedRendererUrl('http://localhost:5173', false), false);
  reject(fixture('app://gnosi'), true);
  reject(fixture('http://localhost:5173'), false);
});

test('rejects unknown values without coercing objects', () => {
  for (const value of [undefined, null, false, 42, {}, [], Symbol('url'),
    new URL('app://gnosi'), { toString: () => assert.fail('Must not coerce input') }]) {
    assert.equal(isTrustedRendererUrl(value, false), false);
    assert.equal(isTrustedRendererUrl(value, true), false);
  }
});

test('rejects lookalikes, credentials, ports, other schemes and malformed URLs', () => {
  for (const url of [
    '', 'not a URL', '/index.html', '//gnosi', 'app:gnosi', 'app:///gnosi',
    'app://gnosi.evil', 'app://evil/gnosi', 'app://gnosi.', 'app://GNOSI',
    'app://gnosı', 'app://%67nosi', 'app://gnosi%2eevil', 'app://[gnosi',
    'app://gnosi:80', 'app://gnosi:5173', 'app://gnosi:',
    'app://user@gnosi', 'app://user:password@gnosi', 'app://:password@gnosi',
    'app://@gnosi', 'app://gnosi@evil', 'app://gnosi\\@evil',
    'http://gnosi', 'https://gnosi', 'file:///index.html', 'about:blank',
    'data:text/html,gnosi', 'blob:app://gnosi/id', 'javascript:void(0)',
    'https://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173',
    'http://localhost', 'http://localhost:80', 'http://localhost:5174',
    'http://localhost:51730', 'http://localhost:05173', 'http://localhost:5173:',
    'http://localhost.evil:5173', 'http://localhost.:5173',
    'http://localhost:5173.evil', 'http://localhost:5173@evil',
    'http://user@localhost:5173', 'http://user:password@localhost:5173',
    'http://:password@localhost:5173', 'http://@localhost:5173',
    'http://%6cocalhost:5173', 'http:localhost:5173', 'http:///localhost:5173',
    ' app://gnosi', 'app://gnosi ', 'app://gno\nsi', 'app://gnosi/\u0000',
    '\thttp://localhost:5173', 'http://local\rhost:5173',
    'http://localhost:5173/\n', 'http://localhost:5173\\evil',
  ]) {
    for (const isDev of [false, true]) {
      assert.equal(isTrustedRendererUrl(url, isDev), false, url);
      reject(fixture(url), isDev);
    }
  }
});

test('rejects missing frames and contents with no current main frame', () => {
  for (const absent of [null, undefined]) {
    const value = fixture();
    value.event.senderFrame = absent;
    value.sender.mainFrame = absent;
    reject(value);
    const noMain = fixture();
    noMain.sender.mainFrame = absent;
    reject(noMain);
  }
});

test('rejects same-origin and foreign iframes by identity', () => {
  for (const url of ['app://gnosi/index.html', 'https://example.invalid']) {
    const value = fixture();
    value.event.senderFrame = { url };
    reject(value);
  }
});

test('rejects a stale frame after main-frame replacement', () => {
  const value = fixture();
  value.sender.mainFrame = { ...value.frame };
  reject(value);
});

test('validates the sending frame URL even when webContents reports a trusted URL', () => {
  const value = fixture('https://example.invalid/?private=fixture');
  assert.equal(value.sender.getURL(), 'app://gnosi/index.html');
  reject(value);
});

test('requires membership of a live window with the identical webContents', () => {
  const value = fixture();
  value.windows.clear();
  reject(value);
  const other = fixture();
  assert.equal(other.sender.id, value.sender.id);
  value.windows.add(other.window);
  reject(value);
  value.windows.add(value.window);
  assert.equal(check(value), undefined);
  value.windows.delete(value.window);
  reject(value);
});

test('does not read mainFrame after webContents destruction', () => {
  const value = fixture();
  let reads = 0;
  value.sender.isDestroyed = () => true;
  Object.defineProperty(value.sender, 'mainFrame', { get() { reads += 1; return value.frame; } });
  reject(value);
  assert.equal(reads, 0);
});

test('skips destroyed windows without reading their webContents', () => {
  const value = fixture();
  let reads = 0;
  value.window.isDestroyed = () => true;
  Object.defineProperty(value.window, 'webContents', { get() { reads += 1; return value.sender; } });
  reject(value);
  value.windows.add({ isDestroyed: () => false, webContents: value.sender });
  assert.equal(check(value), undefined);
  assert.equal(reads, 0);
});

test('supports Electron 28 frames without newer lifecycle members', () => {
  const value = fixture();
  assert.equal(Object.hasOwn(value.frame, 'isDestroyed'), false);
  assert.equal(Object.hasOwn(value.frame, 'detached'), false);
  assert.equal(check(value), undefined);
});

test('uses Electron 43 frame destruction with its native receiver before reading URL', () => {
  const value = fixture();
  let destroyed = false;
  let urlReads = 0;
  value.frame.isDestroyed = function () {
    assert.equal(this, value.frame);
    return destroyed;
  };
  value.frame.detached = false;
  assert.equal(check(value), undefined);
  destroyed = true;
  Object.defineProperty(value.frame, 'url', { get() { urlReads += 1; return 'app://gnosi'; } });
  reject(value);
  assert.equal(urlReads, 0);
});

test('rejects detached frames even when isDestroyed returns false', () => {
  const value = fixture();
  value.frame.isDestroyed = () => false;
  value.frame.detached = true;
  reject(value);
});

test('masks native getter and lifecycle exceptions without leaking their details', () => {
  /** @type {Array<(value: ReturnType<typeof fixture>) => void>} */
  const breakNativeAccess = [
    (value) => { Object.defineProperty(value.event, 'senderFrame', { get: fail }); },
    (value) => { Object.defineProperty(value.sender, 'mainFrame', { get: fail }); },
    (value) => { Object.defineProperty(value.frame, 'url', { get: fail }); },
    (value) => { Object.defineProperty(value.frame, 'detached', { get: fail }); },
    (value) => { Object.defineProperty(value.window, 'webContents', { get: fail }); },
    (value) => { value.sender.isDestroyed = fail; },
    (value) => { value.frame.isDestroyed = fail; },
    (value) => { value.window.isDestroyed = fail; },
  ];
  /** @returns {never} */
  function fail() { throw new Error('Destroyed object: app://gnosi/?private=fixture'); }
  for (const breakAccess of breakNativeAccess) {
    const value = fixture();
    breakAccess(value);
    reject(value);
  }
});

test('does not mutate a live registered sender or frame', () => {
  const value = fixture();
  Object.freeze(value.frame);
  Object.freeze(value.sender);
  Object.freeze(value.window);
  Object.freeze(value.event);
  assert.equal(check(value), undefined);
  assert.deepEqual([...value.windows], [value.window]);
});

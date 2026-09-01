// @ts-check

/**
 * Accept only the renderer authority for the selected runtime mode.
 * Paths, query strings and fragments do not change that authority.
 * @param {unknown} url
 * @param {boolean} isDev
 * @returns {boolean}
 */
function isTrustedRendererUrl(url, isDev) {
  if (typeof url !== 'string' || /[\u0000-\u0020\u007f\\]/u.test(url)) {
    return false;
  }

  // Require literal authorities before parsing: URL normalizes empty userinfo,
  // empty ports, encoded hosts and some malformed HTTP spellings.
  const authority = isDev
    ? /^http:\/\/localhost:5173(?:[/?#]|$)/u
    : /^app:\/\/gnosi(?:[/?#]|$)/u;
  if (!authority.test(url)) return false;

  try {
    const parsed = new URL(url);
    return parsed.username === '' && parsed.password === ''
      && parsed.protocol === (isDev ? 'http:' : 'app:')
      && parsed.hostname === (isDev ? 'localhost' : 'gnosi')
      && parsed.port === (isDev ? '5173' : '');
  } catch {
    return false;
  }
}

/**
 * Electron 28 lacks these frame lifetime APIs; Electron 43 documents both.
 * Optional members preserve compatibility without importing Electron at runtime.
 * @typedef {Electron.WebFrameMain & {
 *   isDestroyed?: () => boolean,
 *   readonly detached?: boolean
 * }} CompatibleFrame
 */

/**
 * Require a live registered window and its current, trusted top-level frame.
 * Native getters may throw after destruction; never expose their error details.
 * @param {Pick<Electron.IpcMainInvokeEvent, 'sender' | 'senderFrame'>} event
 * @param {ReadonlySet<Pick<Electron.BrowserWindow, 'isDestroyed' | 'webContents'>>} mainWindows
 * @param {boolean} isDev
 * @returns {void}
 */
function assertTrustedIpcSender(event, mainWindows, isDev) {
  try {
    const sender = event.sender;
    const frame = /** @type {CompatibleFrame | null | undefined} */ (event.senderFrame);
    if (!sender.isDestroyed() && frame && frame === sender.mainFrame
      && !frame.isDestroyed?.() && frame.detached !== true
      && isTrustedRendererUrl(frame.url, isDev)) {
      for (const window of mainWindows) {
        if (!window.isDestroyed() && window.webContents === sender) return;
      }
    }
  } catch {
    // Fail closed for destroyed/detached native objects, without logging data.
  }
  throw new Error('Untrusted IPC sender');
}

module.exports = { isTrustedRendererUrl, assertTrustedIpcSender };

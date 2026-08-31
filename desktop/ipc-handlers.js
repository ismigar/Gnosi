// @ts-check

const { assertTrustedIpcSender } = require('./ipc-security');

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.prototype.toString.call(value) === '[object Object]';
}

/** @param {unknown[]} args @returns {[]} */
function readEmptyArgs(...args) {
  if (args.length !== 0) throw new TypeError('Unexpected IPC arguments');
  return [];
}

/**
 * Omitted labels retain main's locale/default fallback. Normalization and
 * translated menu construction stay in main; supplied values must be strings.
 * @param {unknown[]} args
 * @returns {import('./ipc-contract').DesktopRequestArgs<'set-application-menu'>}
 */
function readMenuArgs(...args) {
  if (args.length > 1) throw new TypeError('Unexpected menu arguments');
  const payload = args[0];
  if (payload === undefined) return [];
  if (!isRecord(payload)) throw new TypeError('Invalid menu payload');
  const labels = payload.labels;
  if (labels === undefined) return [{}];
  if (!isRecord(labels)) throw new TypeError('Invalid menu labels');
  /** @type {Record<string, string>} */
  const decoded = {};
  for (const [key, value] of Object.entries(labels)) {
    if (typeof value !== 'string') throw new TypeError('Invalid menu label');
    Object.defineProperty(decoded, key, { value, enumerable: true });
  }
  return [{ labels: decoded }];
}

/** @param {unknown} error @returns {string} */
function errorMessage(error) {
  // Errors from another JS realm do not satisfy the local instanceof Error.
  if (typeof error === 'object' && error !== null && 'message' in error
    && typeof error.message === 'string') return error.message;
  return 'Unknown update error';
}

/**
 * Form-filler's owner stays in this already packaged module so extraction does
 * not introduce an undeclared runtime asset or require packaging changes.
 * Preserve native URL/JSON failures: this expected wire shape is a declaration,
 * not a new validator. Destructuring stays async and after the sender guard.
 * @param {import('./ipc-contract').DesktopRequestArgs<'open-form-filler'>[0]} payload
 * @param {import('./ipc-contract').FormFillerDependencies} dependencies
 * @returns {Promise<void>}
 */
async function openFormFiller({ url, profile }, { createFormFillerWindow, log }) {
  const target = new URL(url);
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('Unsupported form URL');
  }
  log('Opening form filler');

  const fillerWin = createFormFillerWindow({
    width: 1000,
    height: 800,
    title: 'Gnosi Form Filler',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    }
  });

  // Neither native promise was awaited in main. Register after loadURL, and
  // retain the persistent listener plus serialization on every completed load.
  fillerWin.loadURL(url);

  fillerWin.webContents.on('did-finish-load', () => {
    log('Form loaded, injecting script...');
    const script = buildFormFillerScript(profile);
    fillerWin.webContents.executeJavaScript(script);
  });
}

/**
 * This renderer program remains byte-identical to main's original template.
 * JSON serialization is the only profile conversion; malformed profiles retain
 * their existing serialization/renderer errors. Synthetic DOM tests execute
 * the generated program: checkJs checks this builder, not code inside strings.
 * @param {unknown} profile
 * @returns {string}
 */
function buildFormFillerScript(profile) {
  return `
        (function() {
          const profile = ${JSON.stringify(profile)};
          ${''}
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
              ${''}
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
}

/**
 * Register all eight extracted handlers once during setupIPC.
 * Every implementation is linked to its exact channel arguments and result.
 * All mutable state and native capabilities remain owned by the caller.
 * @param {import('./ipc-contract').DesktopIpcDependencies} dependencies
 * @returns {void}
 */
function registerIpcHandlers(dependencies) {
  /** @type {import('./ipc-contract').DesktopRequestHandlers} */
  const handlers = {
    'get-app-version': () => dependencies.getAppVersion(),
    'set-application-menu': (payload = {}) => {
      dependencies.installApplicationMenu(payload.labels);
      return true;
    },
    'get-update-status': () => dependencies.getUpdateState(),
    'get-backend-url': () => dependencies.getBackendURL(),
    'get-backend-status': () => dependencies.getBackendStatus(),
    'download-update': async () => {
      if (dependencies.getUpdateState().status !== 'available') return dependencies.getUpdateState();
      dependencies.publishUpdateState({ userInitiated: true, error: undefined });
      try {
        const state = dependencies.getUpdateState();
        if (state.installMode === 'manual') {
          await dependencies.openExternal(dependencies.buildMacInstallerUrl(state.version));
          dependencies.publishUpdateState({ status: 'manual-download' });
        } else {
          await dependencies.downloadUpdate();
        }
      } catch (error) {
        const message = errorMessage(error);
        dependencies.log('Update download action failed:', message);
        dependencies.publishUpdateState({ status: 'error', error: message });
      }
      return dependencies.getUpdateState();
    },
    'install-update': () => {
      const state = dependencies.getUpdateState();
      if (state.status !== 'downloaded' || state.installMode !== 'automatic') return state;
      dependencies.publishUpdateState({ userInitiated: true, error: undefined });
      try {
        dependencies.quitAndInstall();
      } catch (error) {
        const message = errorMessage(error);
        dependencies.log('Update installation failed:', message);
        dependencies.publishUpdateState({ status: 'error', error: message });
      }
      return dependencies.getUpdateState();
    },
    'open-form-filler': payload => openFormFiller(payload, dependencies),
  };

  /**
   * Guard before decoding (even before payload getters). The listener declares
   * the expected wire tuple; each channel retains its existing decoder policy.
   * Form-filler deliberately passes its tuple unchanged: adding validation
   * would change native errors, promise timing and ignored extra arguments.
   * @template {keyof typeof handlers} K
   * @param {K} channel
   * @param {(...args: import('./ipc-contract').DesktopRequestArgs<K>) => import('./ipc-contract').DesktopRequestArgs<K>} decode
   * @returns {void}
   */
  function handle(channel, decode) {
    /**
     * @param {Electron.IpcMainInvokeEvent} event
     * @param {import('./ipc-contract').DesktopRequestArgs<K>} args
     */
    function listener(event, ...args) {
      assertTrustedIpcSender(event, dependencies.mainWindows, dependencies.isDev);
      return handlers[channel](...decode(...args));
    }
    dependencies.ipcMain.handle(channel, listener);
  }

  handle('get-app-version', readEmptyArgs);
  handle('set-application-menu', readMenuArgs);
  handle('get-update-status', readEmptyArgs);
  handle('get-backend-url', readEmptyArgs);
  handle('download-update', readEmptyArgs);
  handle('get-backend-status', readEmptyArgs);
  handle('install-update', readEmptyArgs);
  handle('open-form-filler', (...args) => args);
}

module.exports = { registerIpcHandlers };

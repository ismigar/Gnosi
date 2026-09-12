// @ts-check
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { resolveDataPath } = require('./profile-startup');

/** @type {Record<string, {title: string, message: string, buttonLabel: string}>} */
const MESSAGES = {
  en: { title: 'Choose your Gnosi vault', message: 'Choose an existing vault folder, or create a new folder for your knowledge.', buttonLabel: 'Use this folder' },
  ca: { title: 'Tria la biblioteca de Gnosi', message: 'Tria una carpeta amb una biblioteca existent o crea una carpeta nova per al teu coneixement.', buttonLabel: 'Utilitza aquesta carpeta' },
  es: { title: 'Elige tu biblioteca de Gnosi', message: 'Elige una carpeta con una biblioteca existente o crea una carpeta nueva para tu conocimiento.', buttonLabel: 'Usar esta carpeta' },
  fr: { title: 'Choisissez votre bibliothèque Gnosi', message: 'Choisissez un dossier contenant une bibliothèque existante ou créez un dossier pour vos connaissances.', buttonLabel: 'Utiliser ce dossier' },
};

/** @param {string} locale @returns {Electron.OpenDialogOptions} */
function vaultDialogOptions(locale) {
  const language = String(locale || '').trim().toLowerCase().replaceAll('_', '-').split('-')[0];
  return {
    ...(MESSAGES[language || 'en'] || MESSAGES.en),
    properties: ['openDirectory', 'createDirectory'],
  };
}

/**
 * Only the explicit desktop folder selection is persisted; Vault contents stay untouched.
 * @param {{environment: NodeJS.ProcessEnv, launch: (environment: NodeJS.ProcessEnv) => Promise<Awaited<ReturnType<import('./backend-process').launchBackend>>>, chooseDirectory: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>, locale: string, backendCwd?: string, isQuitting?: () => boolean}} options
 */
async function launchConfiguredBackend({ environment, launch, chooseDirectory, locale, backendCwd = process.cwd(), isQuitting = () => false }) {
  if (!environment.GNOSI_DATA_DIR) throw new Error('Desktop data directory is missing');
  const dataDirectory = resolveDataPath(environment.GNOSI_DATA_DIR, backendCwd, os.homedir());
  const selectionFile = path.join(dataDirectory, 'desktop-vault.json');
  let selectedEnvironment = { ...environment };
  if (!environment.DIGITAL_BRAIN_VAULT_PATH && !environment.VAULT_HOST_PATH) {
    try {
      /** @type {unknown} */
      const stored = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
      if (typeof stored === 'object' && stored !== null && 'path' in stored
          && typeof stored.path === 'string' && path.isAbsolute(stored.path) && fs.statSync(stored.path).isDirectory()) {
        selectedEnvironment.DIGITAL_BRAIN_VAULT_PATH = stored.path;
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      // A missing selection or unavailable volume needs the normal setup flow.
    }
  }
  let handle = await launch(selectedEnvironment);
  if (handle.vaultConfigured !== false) return handle;

  // Configuration-dependent APIs cannot initialize a Vault. Complete native
  // setup before exposing the renderer, and reap the old child before relaunch.
  await handle.stop();
  if (isQuitting()) return null;
  const selection = await chooseDirectory(vaultDialogOptions(locale));
  const vaultPath = selection.filePaths[0];
  if (isQuitting() || selection.canceled || !vaultPath) return null;
  if (!path.isAbsolute(vaultPath) || !fs.statSync(vaultPath).isDirectory()) {
    throw new Error('The selected Vault folder is not available');
  }
  selectedEnvironment = { ...environment, DIGITAL_BRAIN_VAULT_PATH: vaultPath };
  handle = await launch(selectedEnvironment);
  if (isQuitting()) {
    await handle.stop();
    return null;
  }
  if (handle.vaultConfigured !== true) {
    await handle.stop();
    throw new Error('The selected Vault could not be configured');
  }
  try {
    fs.mkdirSync(path.dirname(selectionFile), { recursive: true });
    const temporary = `${selectionFile}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ path: vaultPath }) + '\n', { mode: 0o600 });
      fs.renameSync(temporary, selectionFile);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  } catch (error) {
    await handle.stop();
    throw error;
  }
  return handle;
}

module.exports = { launchConfiguredBackend, vaultDialogOptions };

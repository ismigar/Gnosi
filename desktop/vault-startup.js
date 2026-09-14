// @ts-check
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { resolveDataPath } = require('./profile-startup');
const { resolveVaultFolder } = require('./vault-folders');

/** @type {Record<string, {title: string, message: string, buttonLabel: string}>} */
const MESSAGES = {
  en: { title: 'Choose your Gnosi folder', message: 'Choose the folder containing your vaults. Existing vaults will appear in the vault list. An empty folder starts with a Principal vault.', buttonLabel: 'Use this folder' },
  ca: { title: 'Tria la carpeta de Gnosi', message: 'Tria la carpeta que conté els vaults. Els existents apareixeran a la llista. Una carpeta buida començarà amb un vault Principal.', buttonLabel: 'Utilitza aquesta carpeta' },
  es: { title: 'Elige la carpeta de Gnosi', message: 'Elige la carpeta que contiene los vaults. Los existentes aparecerán en la lista. Una carpeta vacía empezará con un vault Principal.', buttonLabel: 'Usar esta carpeta' },
  fr: { title: 'Choisissez le dossier Gnosi', message: 'Choisissez le dossier contenant vos coffres. Les coffres existants apparaîtront dans la liste. Un dossier vide commencera avec un coffre Principal.', buttonLabel: 'Utiliser ce dossier' },
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
  /** @type {string | undefined} */
  let vaultSelectionId;
  /** @type {{vault: string, root: string} | undefined} */
  let resolvedSelection;
  if (!environment.DIGITAL_BRAIN_VAULT_PATH && !environment.VAULT_HOST_PATH) {
    try {
      /** @type {unknown} */
      const stored = JSON.parse(fs.readFileSync(selectionFile, 'utf8'));
      if (typeof stored === 'object' && stored !== null && 'path' in stored
          && typeof stored.path === 'string' && path.isAbsolute(stored.path) && fs.statSync(stored.path).isDirectory()) {
        resolvedSelection = resolveVaultFolder(stored.path);
        selectedEnvironment.DIGITAL_BRAIN_VAULT_PATH = resolvedSelection.vault;
        selectedEnvironment.GNOSI_VAULTS_ROOT = resolvedSelection.root;
        selectedEnvironment.GNOSI_DESKTOP_VAULT_DISCOVERY = '1';
        if ('selectionId' in stored && typeof stored.selectionId === 'string'
            && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(stored.selectionId)) {
          vaultSelectionId = stored.selectionId;
        }
        if (resolvedSelection.vault !== stored.path) vaultSelectionId = randomUUID();
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      // A missing selection or unavailable volume needs the normal setup flow.
    }
  }
  let handle = await launch(selectedEnvironment);
  if (handle.vaultConfigured !== false) {
    if (resolvedSelection && handle.vaultConfigured === true) {
      try { persistSelection(selectionFile, resolvedSelection, vaultSelectionId); }
      catch (error) { await handle.stop(); throw error; }
    }
    return Object.assign(handle, { vaultSelectionId });
  }

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
  resolvedSelection = resolveVaultFolder(vaultPath);
  selectedEnvironment = { ...environment, DIGITAL_BRAIN_VAULT_PATH: resolvedSelection.vault,
    GNOSI_VAULTS_ROOT: resolvedSelection.root, GNOSI_DESKTOP_VAULT_DISCOVERY: '1' };
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
    vaultSelectionId = randomUUID();
    persistSelection(selectionFile, resolvedSelection, vaultSelectionId);
  } catch (error) {
    await handle.stop();
    throw error;
  }
  return Object.assign(handle, { vaultSelectionId });
}

/** @param {string} file @param {{vault: string, root: string}} selection @param {string | undefined} selectionId */
function persistSelection(file, selection, selectionId) {
  const contents = JSON.stringify({ path: selection.vault, root: selection.root, selectionId }) + '\n';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === contents) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, contents, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
}

module.exports = { launchConfiguredBackend, vaultDialogOptions, persistSelection };

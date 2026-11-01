// @ts-check

// These native dialogs precede the React renderer and its i18next provider.
// Keep the fallback catalog dependency-free and complete in all app languages.
const messages = Object.freeze({
  en: {
    title: 'Gnosi — backend startup',
    missing: 'The packaged backend is missing. Reinstall Gnosi before opening it.',
    failed: 'Gnosi could not start its backend.',
    recovery: 'Quit and reopen Gnosi. If the problem persists, reinstall the application.',
    cloud: 'Gnosi cannot read the vault configuration yet.',
    cloudRecovery: 'Check that your cloud provider (such as OneDrive or iCloud) is running and connected, or make the vault configuration available offline. Then retry. Your vault will stay selected.',
    retry: 'Retry', quit: 'Quit Gnosi',
  },
  ca: {
    title: 'Gnosi — arrencada del backend',
    missing: 'Falta el backend del paquet. Torna a instal·lar Gnosi abans d’obrir-lo.',
    failed: 'Gnosi no ha pogut iniciar el backend.',
    recovery: 'Tanca Gnosi i torna’l a obrir. Si el problema continua, torna a instal·lar l’aplicació.',
    cloud: 'Gnosi encara no pot llegir la configuració del vault.',
    cloudRecovery: 'Comprova que el proveïdor del núvol (com OneDrive o iCloud) estigui obert i connectat, o fes que la configuració del vault estigui disponible sense connexió. Després, torna-ho a provar. Es mantindrà el vault seleccionat.',
    retry: 'Torna-ho a provar', quit: 'Surt de Gnosi',
  },
  es: {
    title: 'Gnosi — inicio del backend',
    missing: 'Falta el backend del paquete. Vuelve a instalar Gnosi antes de abrirlo.',
    failed: 'Gnosi no ha podido iniciar el backend.',
    recovery: 'Cierra Gnosi y vuelve a abrirlo. Si el problema persiste, vuelve a instalar la aplicación.',
    cloud: 'Gnosi aún no puede leer la configuración del vault.',
    cloudRecovery: 'Comprueba que el proveedor de la nube (como OneDrive o iCloud) esté abierto y conectado, o haz que la configuración del vault esté disponible sin conexión. Después, vuelve a intentarlo. Se mantendrá el vault seleccionado.',
    retry: 'Reintentar', quit: 'Salir de Gnosi',
  },
  fr: {
    title: 'Gnosi — démarrage du backend',
    missing: 'Le backend du paquet est manquant. Réinstallez Gnosi avant de l’ouvrir.',
    failed: 'Gnosi n’a pas pu démarrer son backend.',
    recovery: 'Quittez puis rouvrez Gnosi. Si le problème persiste, réinstallez l’application.',
    cloud: 'Gnosi ne peut pas encore lire la configuration du coffre.',
    cloudRecovery: 'Vérifiez que votre fournisseur cloud (comme OneDrive ou iCloud) est ouvert et connecté, ou rendez la configuration du coffre disponible hors connexion. Réessayez ensuite. Le coffre sélectionné sera conservé.',
    retry: 'Réessayer', quit: 'Quitter Gnosi',
  },
});

/** @param {string} locale */
function catalog(locale) {
  const language = locale.toLowerCase().split(/[-_]/)[0];
  return language === 'ca' || language === 'es' || language === 'fr'
    ? messages[language] : messages.en;
}

/** @param {string} locale @param {unknown} error */
function backendStartupMessage(locale, error) {
  const text = catalog(locale);
  const missing = typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'GNOSI_BACKEND_MISSING';
  return { title: text.title, message: missing ? text.missing : `${text.failed}\n${text.recovery}` };
}

/** @param {unknown} error */
function isCloudStartupError(error) {
  return typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'GNOSI_CLOUD_METADATA_UNAVAILABLE';
}

/** @param {string} locale @returns {Electron.MessageBoxOptions} */
function cloudStartupDialog(locale) {
  const text = catalog(locale);
  return { type: 'warning', title: text.title, message: text.cloud,
    detail: text.cloudRecovery, buttons: [text.retry, text.quit], defaultId: 0, cancelId: 1,
    noLink: true };
}

module.exports = { backendStartupMessage, isCloudStartupError, cloudStartupDialog };

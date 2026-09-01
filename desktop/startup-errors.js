// @ts-check

// These native dialogs precede the React renderer and its i18next provider.
// Keep the fallback catalog dependency-free and complete in all app languages.
const messages = Object.freeze({
  en: {
    title: 'Gnosi — backend startup',
    missing: 'The packaged backend is missing. Reinstall Gnosi before opening it.',
    failed: 'Gnosi could not start its backend.',
    recovery: 'Check that port 5002 is available, then reopen Gnosi. Diagnostic details are in the application log.',
  },
  ca: {
    title: 'Gnosi — arrencada del backend',
    missing: 'Falta el backend del paquet. Torna a instal·lar Gnosi abans d’obrir-lo.',
    failed: 'Gnosi no ha pogut iniciar el backend.',
    recovery: 'Comprova que el port 5002 estigui disponible i torna a obrir Gnosi. Els detalls del diagnòstic són al registre de l’aplicació.',
  },
  es: {
    title: 'Gnosi — inicio del backend',
    missing: 'Falta el backend del paquete. Vuelve a instalar Gnosi antes de abrirlo.',
    failed: 'Gnosi no ha podido iniciar el backend.',
    recovery: 'Comprueba que el puerto 5002 esté disponible y vuelve a abrir Gnosi. Los detalles del diagnóstico están en el registro de la aplicación.',
  },
  fr: {
    title: 'Gnosi — démarrage du backend',
    missing: 'Le backend du paquet est manquant. Réinstallez Gnosi avant de l’ouvrir.',
    failed: 'Gnosi n’a pas pu démarrer son backend.',
    recovery: 'Vérifiez que le port 5002 est disponible, puis rouvrez Gnosi. Les détails du diagnostic se trouvent dans le journal de l’application.',
  },
});

/** @param {string} locale @param {unknown} error */
function backendStartupMessage(locale, error) {
  const language = locale.toLowerCase().split(/[-_]/)[0];
  const text = language === 'ca' || language === 'es' || language === 'fr'
    ? messages[language] : messages.en;
  const missing = typeof error === 'object' && error !== null
    && 'code' in error && error.code === 'GNOSI_BACKEND_MISSING';
  return { title: text.title, message: missing ? text.missing : `${text.failed}\n${text.recovery}` };
}

module.exports = { backendStartupMessage };

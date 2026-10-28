// @ts-check
// Native recovery remains available after the React renderer has exited.
const messages = Object.freeze({
  ca: { title: 'Gnosi — recuperació de la pantalla', message: 'La pantalla de Gnosi s’ha tancat inesperadament.', detail: 'Els continguts desats continuen disponibles. Pots reobrir la pantalla sense reiniciar el servei de Gnosi.', reload: 'Reobre la pantalla', later: 'Ara no' },
  en: { title: 'Gnosi — screen recovery', message: 'The Gnosi screen closed unexpectedly.', detail: 'Saved content remains available. You can reopen the screen without restarting the Gnosi service.', reload: 'Reopen screen', later: 'Not now' },
  es: { title: 'Gnosi — recuperación de la pantalla', message: 'La pantalla de Gnosi se ha cerrado inesperadamente.', detail: 'Los contenidos guardados siguen disponibles. Puedes volver a abrir la pantalla sin reiniciar el servicio de Gnosi.', reload: 'Reabrir pantalla', later: 'Ahora no' },
  fr: { title: 'Gnosi — récupération de l’écran', message: 'L’écran de Gnosi s’est fermé de façon inattendue.', detail: 'Les contenus enregistrés restent disponibles. Vous pouvez rouvrir l’écran sans redémarrer le service Gnosi.', reload: 'Rouvrir l’écran', later: 'Plus tard' },
});

/**
 * @param {{window: import('electron').BrowserWindow, dialog: Pick<typeof import('electron').dialog, 'showMessageBox'>, locale: string, isQuitting: () => boolean, record: (reason: string, exitCode: number) => void}} options
 */
function registerRendererRecovery({ window, dialog, locale, isQuitting, record }) {
  const language = locale.toLowerCase().split(/[-_]/)[0];
  const text = language === 'ca' || language === 'es' || language === 'fr' ? messages[language] : messages.en;
  let pending = false;
  /** @param {Electron.Event} _event @param {Electron.RenderProcessGoneDetails} details */
  const stopped = async (_event, details) => {
    if (details.reason === 'clean-exit' || isQuitting() || window.isDestroyed()) return;
    record(details.reason, details.exitCode);
    if (pending) return;
    pending = true;
    try {
      const choice = await dialog.showMessageBox(window, { type: 'error', title: text.title, message: text.message, detail: text.detail, buttons: [text.reload, text.later], defaultId: 0, cancelId: 1, noLink: true });
      if (choice.response === 0 && !isQuitting() && !window.isDestroyed()) window.webContents.reload();
    } catch {
      record('recovery-unavailable', 0);
    } finally { pending = false; }
  };
  window.webContents.on('render-process-gone', stopped);
  window.once('closed', () => { window.webContents.removeListener('render-process-gone', stopped); });
}
module.exports = { registerRendererRecovery };

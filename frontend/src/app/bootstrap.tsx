import { createRoot } from 'react-dom/client';
import i18n from '../i18n';
import { GlobalTooltip } from '../shared/ui/tooltip/GlobalTooltip';
import { syncActiveVaultCookie } from '../lib/fileResource';
import { initializeInterfaceLanguage } from '../lib/interfaceLanguage';
import { installDesktopApplicationMenu } from './desktop/desktopMenu';
import { initializeVaultRouting, legacyBrowserPathToCanonical } from '../lib/vaultRouting';
import App from './App';
import { AppProviders } from './AppProviders';

export async function bootstrap(): Promise<void> {
  // Native images, streams and sockets need the active vault before any request.
  syncActiveVaultCookie();
  await initializeVaultRouting();
  const canonicalPath = legacyBrowserPathToCanonical(window.location.pathname);
  if (canonicalPath !== window.location.pathname && canonicalPath.startsWith('/@')) {
    window.history.replaceState(
      window.history.state,
      '',
      `${canonicalPath}${window.location.search}${window.location.hash}`,
    );
  }
  await initializeInterfaceLanguage(i18n);
  installDesktopApplicationMenu(i18n);
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Gnosi root element was not found.');
  createRoot(rootElement).render(
    <AppProviders>
      <App />
      <GlobalTooltip />
    </AppProviders>,
  );
}

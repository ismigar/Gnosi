import { createRoot } from 'react-dom/client';
import i18n from '../shared/i18n/i18n';
import { GlobalTooltip } from '../shared/ui/tooltip/GlobalTooltip';
import { syncActiveVaultCookie } from '../shared/resources/fileResource';
import { initializeInterfaceLanguage } from './initialization/interfaceLanguage';
import { installDesktopApplicationMenu } from './desktop/desktopMenu';
import { initializeVaultRouting, legacyBrowserPathToCanonical } from '../shared/routing/vaultRouting';
import App from './App';
import { AppProviders } from './AppProviders';
import { preloadApplicationRoute } from './routePreload';

export async function bootstrap(): Promise<void> {
  // Native images, streams and sockets need the active vault before any request.
  syncActiveVaultCookie();
  await Promise.all([
    initializeVaultRouting(),
    initializeInterfaceLanguage(i18n),
    preloadApplicationRoute(window.location.pathname),
  ]);
  const canonicalPath = legacyBrowserPathToCanonical(window.location.pathname);
  if (canonicalPath !== window.location.pathname && canonicalPath.startsWith('/@')) {
    window.history.replaceState(
      window.history.state,
      '',
      `${canonicalPath}${window.location.search}${window.location.hash}`,
    );
  }
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

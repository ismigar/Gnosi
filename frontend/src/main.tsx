import { StrictMode } from 'react'
import i18n from './i18n';
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import { syncActiveVaultCookie } from './lib/fileResource.js'
import { AuthProvider } from './context/AuthProvider'
import { initializeInterfaceLanguage } from './lib/interfaceLanguage'
import { installDesktopApplicationMenu } from './lib/desktopMenu.js'
import {
    initializeVaultRouting,
    legacyBrowserPathToCanonical,
} from './lib/vaultRouting.js'
import { GlobalTooltip } from './components/GlobalTooltip.jsx'
import { ApiProvider } from './shared/api/ApiProvider'

// Multi-vault: reflects the persisted active vault in a same-origin cookie
// BEFORE the first render, because EVERY request —raw fetch, <img>/<video>/<iframe>
// native, background-image, SSE, /api/chat, WebSocket— carries the vault without
// depend on the axios header. Without this, all these channels fall back to the
// default vault. See setActiveVaultCookie in lib/fileResource.js.
syncActiveVaultCookie();

async function bootstrap(): Promise<void> {
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
        <StrictMode>
            <ApiProvider>
                <BrowserRouter>
                    <AuthProvider>
                        <App />
                        <GlobalTooltip />
                    </AuthProvider>
                </BrowserRouter>
            </ApiProvider>
        </StrictMode>,
    );
}

void bootstrap();

import React from 'react'
import i18n from './i18n';
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import { installPageEtagInterceptor } from './lib/pageEtagInterceptor.js'
import { syncActiveVaultCookie } from './lib/fileResource.js'
import { AuthProvider } from './context/AuthContext.jsx'
import { initializeInterfaceLanguage } from './lib/interfaceLanguage.js'

// Multi-vault: reflects the active vault (localStorage) in a same-origin cookie
// BEFORE the first render, because EVERY request —raw fetch, <img>/<video>/<iframe>
// native, background-image, SSE, /api/chat, WebSocket— carries the vault without
// depend on the axios header. Without this, all these channels fall back to the
// default vault. See setActiveVaultCookie in lib/fileResource.js.
syncActiveVaultCookie();

// Optimistic concurrency for /api/vault/pages — auto-attaches `expected_etag`
// to PATCH/PUT and broadcasts `pageEtagConflict` DOM events on 409. See
// lib/pageEtagInterceptor.js for the rationale.
installPageEtagInterceptor();

async function bootstrap() {
    await initializeInterfaceLanguage(i18n);
    ReactDOM.createRoot(document.getElementById('root')).render(
        <React.StrictMode>
            <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <AuthProvider>
                    <App />
                </AuthProvider>
            </BrowserRouter>
        </React.StrictMode>,
    )
}

void bootstrap();

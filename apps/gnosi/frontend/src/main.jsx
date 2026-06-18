import React from 'react'
import './i18n';
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import { installPageEtagInterceptor } from './lib/pageEtagInterceptor.js'
import { AuthProvider } from './context/AuthContext.jsx'

// Optimistic concurrency for /api/vault/pages — auto-attaches `expected_etag`
// to PATCH/PUT and broadcasts `pageEtagConflict` DOM events on 409. See
// lib/pageEtagInterceptor.js for the rationale.
installPageEtagInterceptor();

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AuthProvider>
                <App />
            </AuthProvider>
        </BrowserRouter>
    </React.StrictMode>,
)

/**
 * collabProvider.js — minimal Yjs provider on top of the existing WebSocket channel
 * (`/api/vault/collab/{pageId}`). Transports document updates (CRDT) and
 * awareness (cursors/selection) as JSON messages with base64 payload, so
 * it reuses the same relay that presence already uses.
 *
 * Passed to BlockNote via `useCreateBlockNote({ collaboration: { provider,
 * fragment, user } })`. It is ONLY instantiated in org mode (see useYjsCollaboration).
 */
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate, applyAwarenessUpdate } from 'y-protocols/awareness';
import { ensureBackendOrigin } from './electron';
import { canonicalizeVaultApiUrl } from './vaultRouting';
import { openWebSocket, WEB_SOCKET_OPEN_STATE } from '../shared/api/specialized-transports';

function toBase64(uint8) {
    let binary = '';
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    return btoa(binary);
}

function fromBase64(b64) {
    const binary = atob(b64);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return arr;
}

async function buildWsUrl(pageId) {
    // In the Electron shell the `app://` scheme does not intercept WebSocket
    // upgrades, so connect directly to the backend host instead of relying on
    // window.location.host (which is empty under `app://`).
    const backendOrigin = await ensureBackendOrigin();
    const proto = backendOrigin
        ? (backendOrigin.startsWith('https') ? 'wss' : 'ws')
        : (window.location.protocol === 'https:' ? 'wss' : 'ws');
    const host = backendOrigin ? backendOrigin.replace(/^https?:\/\//, '') : window.location.host;
    const params = new URLSearchParams({
        user_id: localStorage.getItem('gnosi_user_id') || 'anon',
        name: localStorage.getItem('gnosi_user_email') || 'Anònim',
    });
    const path = canonicalizeVaultApiUrl(`/api/vault/collab/${encodeURIComponent(pageId)}`);
    return `${proto}://${host}${path}?${params.toString()}`;
}

/**
 * Collaboration provider compatible with BlockNote: exposes `doc` and
 * `awareness`. Connects on its own and forwards/applies Yjs updates and awareness.
 */
export class GnosiCollabProvider {
    constructor(pageId, doc, user) {
        this.pageId = pageId;
        this.doc = doc;
        this.awareness = new Awareness(doc);
        this.ws = null;
        this._closed = false;
        this._retry = null;

        if (user) {
            this.awareness.setLocalStateField('user', user);
        }

        // Local doc updates → send to peers.
        this._docHandler = (update, origin) => {
            if (origin === this) return; // we don't forward what comes from the network
            this._send({ type: 'yjs-update', data: toBase64(update) });
        };
        this.doc.on('update', this._docHandler);

        // Local awareness changes → send to peers.
        this._awarenessHandler = ({ added, updated, removed }) => {
            const changed = added.concat(updated, removed);
            const upd = encodeAwarenessUpdate(this.awareness, changed);
            this._send({ type: 'yjs-awareness', data: toBase64(upd) });
        };
        this.awareness.on('update', this._awarenessHandler);

        this._connect();
    }

    _send(msg) {
        if (this.ws && this.ws.readyState === WEB_SOCKET_OPEN_STATE) {
            try { this.ws.send(JSON.stringify(msg)); } catch { /* noop */ }
        }
    }

    async _connect() {
        let ws;
        try {
            ws = openWebSocket(await buildWsUrl(this.pageId));
        } catch {
            return;
        }
        this.ws = ws;

        ws.onopen = () => {
            // On open, we send the full doc state (as an update) and our
            // awareness so others see us right away.
            try {
                const state = Y.encodeStateAsUpdate(this.doc);
                this._send({ type: 'yjs-update', data: toBase64(state) });
                const upd = encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
                this._send({ type: 'yjs-awareness', data: toBase64(upd) });
            } catch { /* noop */ }
        };

        ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }
            if (msg?.type === 'yjs-update' && typeof msg.data === 'string') {
                try { Y.applyUpdate(this.doc, fromBase64(msg.data), this); } catch { /* noop */ }
            } else if (msg?.type === 'yjs-awareness' && typeof msg.data === 'string') {
                try { applyAwarenessUpdate(this.awareness, fromBase64(msg.data), this); } catch { /* noop */ }
            }
        };

        ws.onclose = () => {
            if (!this._closed) this._retry = setTimeout(() => this._connect(), 3000);
        };
        ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    }

    destroy() {
        this._closed = true;
        if (this._retry) clearTimeout(this._retry);
        try { this.doc.off('update', this._docHandler); } catch { /* noop */ }
        try { this.awareness.off('update', this._awarenessHandler); } catch { /* noop */ }
        try { this.awareness.destroy(); } catch { /* noop */ }
        try { this.ws?.close(); } catch { /* noop */ }
        this.ws = null;
    }
}

export default GnosiCollabProvider;

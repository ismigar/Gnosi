/**
 * useCollaboration — per-page collaboration WebSocket channel.
 *
 * Skeleton (Path B). For now it exposes **presence** (who else is on the
 * same page) and a generic `send()` for future messages (cursor,
 * Yjs updates). The transport is already in place; adding CRDT will just mean sending
 * `{type: "update", ...}` through this same `send`.
 *
 * Does nothing in personal mode (a single user): if the mode isn't 'org' or there
 * is no `pageId`, it opens no connection and `peers` stays empty. The mode is resolved
 * via `/api/health` (same pattern as AppSidebar), so this hook
 * doesn't depend on the auth layer and collaboration can be rolled out
 * independently. Any network error leaves the mode at 'personal' →
 * disabled → zero behavior change for single-user usage.
 *
 * Identity: read from localStorage (`gnosi_user_id`/`gnosi_user_email`),
 * which the auth flow keeps up to date when present. The server, if it receives a
 * valid session cookie, trusts it over this identity.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { ensureBackendOrigin } from '../lib/electron';
import { canonicalizeVaultApiUrl } from '../lib/vaultRouting';

async function buildWsUrl(pageId) {
    // In the Electron shell the `app://` scheme does not intercept WebSocket
    // upgrades, so connect directly to the backend host instead of relying on
    // window.location.host (which is empty under `app://`).
    const backendOrigin = await ensureBackendOrigin();
    const base = backendOrigin || window.location.origin;
    const proto = base.startsWith('https') ? 'wss' : 'ws';
    const host = backendOrigin ? backendOrigin.replace(/^https?:\/\//, '') : window.location.host;
    const params = new URLSearchParams({
        user_id: localStorage.getItem('gnosi_user_id') || 'anon',
        name: localStorage.getItem('gnosi_user_email') || 'Anònim',
    });
    const path = canonicalizeVaultApiUrl(`/api/vault/collab/${encodeURIComponent(pageId)}`);
    return `${proto}://${host}${path}?${params.toString()}`;
}

export function useCollaboration(pageId) {
    const [peers, setPeers] = useState([]);
    // The mode (personal/org) is resolved via /api/health. Defaults to 'personal'
    // → disabled, so a network error changes nothing for the single user.
    const [gnosiMode, setGnosiMode] = useState('personal');
    const wsRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        fetch('/api/health', { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                if (!cancelled && data?.gnosi_mode) setGnosiMode(data.gnosi_mode);
            })
            .catch(() => {
                /* network down → stays 'personal' (collaboration disabled) */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const enabled = gnosiMode === 'org' && !!pageId;
    const selfId = localStorage.getItem('gnosi_user_id') || 'anon';

    useEffect(() => {
        // When disabled (personal mode or no page) we don't open anything.
        // No need to reset `peers` here: it starts empty and cleanup resets it
        // when leaving an active state (avoids a synchronous setState inside the effect).
        if (!enabled) {
            return undefined;
        }

        let closed = false;
        let retryTimer = null;

        const connect = async () => {
            let ws;
            try {
                ws = new WebSocket(await buildWsUrl(pageId));
            } catch {
                return; // Invalid URL or WS unavailable
            }
            wsRef.current = ws;

            ws.onmessage = (event) => {
                let msg;
                try {
                    msg = JSON.parse(event.data);
                } catch {
                    return;
                }
                if (msg?.type === 'presence') {
                    // We exclude the user themselves: the indicator shows "the others".
                    setPeers((msg.users || []).filter((u) => u.id !== selfId));
                }
            };

            ws.onclose = () => {
                if (!closed) {
                    // Simple reconnection with a fixed backoff (3s). Enough for
                    // the skeleton; an exponential backoff would be the next step.
                    retryTimer = setTimeout(connect, 3000);
                }
            };

            ws.onerror = () => {
                try {
                    ws.close();
                } catch {
                    /* noop */
                }
            };
        };

        connect();

        return () => {
            closed = true;
            if (retryTimer) clearTimeout(retryTimer);
            try {
                wsRef.current?.close();
            } catch {
                /* noop */
            }
            wsRef.current = null;
            // Reset presence on unmount or when the page/identity changes.
            setPeers([]);
        };
        // selfId is derived from localStorage; we reconnect if the page or state changes.
    }, [enabled, pageId, selfId]);

    const send = useCallback((message) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        }
    }, []);

    return { peers, send, enabled };
}

export default useCollaboration;

/**
 * useCollaboration — canal WebSocket de col·laboració per pàgina.
 *
 * Esquelet (Via B). De moment exposa la **presència** (qui més és a la
 * mateixa pàgina) i un `send()` genèric per a missatges futurs (cursor,
 * updates Yjs). El transport ja hi és; afegir CRDT serà enviar
 * `{type: "update", ...}` per aquest mateix `send`.
 *
 * No fa res en mode personal (un sol usuari): si el mode no és 'org' o no hi
 * ha `pageId`, no obre cap connexió i `peers` queda buit. El mode es resol
 * via `/api/health` (mateix patró que AppSidebar), de manera que aquest hook
 * no depèn de la capa d'auth i la col·laboració es pot desplegar de forma
 * independent. Qualsevol error de xarxa deixa el mode a 'personal' →
 * desactivat → zero canvi de comportament per a l'ús d'un sol usuari.
 *
 * Identitat: es llegeix de localStorage (`gnosi_user_id`/`gnosi_user_email`),
 * que el flux d'auth manté actualitzat quan hi és. El servidor, si rep una
 * cookie de sessió vàlida, hi confia per sobre d'aquesta identitat.
 */
import { useEffect, useRef, useState, useCallback } from 'react';

function buildWsUrl(pageId) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const params = new URLSearchParams({
        user_id: localStorage.getItem('gnosi_user_id') || 'anon',
        name: localStorage.getItem('gnosi_user_email') || 'Anònim',
    });
    return `${proto}://${window.location.host}/api/vault/collab/${encodeURIComponent(pageId)}?${params.toString()}`;
}

export function useCollaboration(pageId) {
    const [peers, setPeers] = useState([]);
    // El mode (personal/org) es resol via /api/health. Per defecte 'personal'
    // → desactivat, així un error de xarxa no canvia res per a l'usuari únic.
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
                /* xarxa caiguda → roman 'personal' (col·laboració desactivada) */
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const enabled = gnosiMode === 'org' && !!pageId;
    const selfId = localStorage.getItem('gnosi_user_id') || 'anon';

    useEffect(() => {
        // Quan està desactivat (mode personal o sense pàgina) no obrim res.
        // No cal resetar `peers` aquí: comença buit i el cleanup el reseteja
        // en sortir d'un estat actiu (evita setState síncron dins l'effect).
        if (!enabled) {
            return undefined;
        }

        let closed = false;
        let retryTimer = null;

        const connect = () => {
            let ws;
            try {
                ws = new WebSocket(buildWsUrl(pageId));
            } catch {
                return; // URL invàlida o WS no disponible
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
                    // Excloem el propi usuari: l'indicador mostra "els altres".
                    setPeers((msg.users || []).filter((u) => u.id !== selfId));
                }
            };

            ws.onclose = () => {
                if (!closed) {
                    // Reconnexió simple amb backoff fix (3s). Suficient per a
                    // l'esquelet; un backoff exponencial seria el pas següent.
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
            // Reset de presència en desmuntar o canviar de pàgina/identitat.
            setPeers([]);
        };
        // selfId es deriva de localStorage; reconnectem si canvia pàgina o estat.
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

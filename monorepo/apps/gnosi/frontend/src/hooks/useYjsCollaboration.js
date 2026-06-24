/**
 * useYjsCollaboration — retorna l'opció `collaboration` per a BlockNote quan
 * estem en mode org (multiusuari). En mode personal retorna `{collaboration:
 * undefined, ready:false}` i NO crea cap Y.Doc ni connexió → comportament
 * idèntic a l'editor d'un sol usuari (zero regressió).
 *
 * El mode es resol via `/api/health` (mateix patró que useCollaboration) i es
 * memoritza a nivell de mòdul perquè no es repeteixi a cada pàgina.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { GnosiCollabProvider } from '../lib/collabProvider';

let _modePromise = null;
function resolveMode() {
    if (!_modePromise) {
        _modePromise = fetch('/api/health', { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d?.gnosi_mode || 'personal')
            .catch(() => 'personal');
    }
    return _modePromise;
}

// Colors estables per usuari (cursors), alineats amb CollaborationPresence.
const CURSOR_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];
function colorFor(id) {
    let h = 0;
    for (let i = 0; i < String(id).length; i++) h = (h * 31 + String(id).charCodeAt(i)) | 0;
    return CURSOR_COLORS[Math.abs(h) % CURSOR_COLORS.length];
}

export function useYjsCollaboration(pageId) {
    const [isOrg, setIsOrg] = useState(false);
    const providerRef = useRef(null);
    const docRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        resolveMode().then((mode) => { if (!cancelled) setIsOrg(mode === 'org'); });
        return () => { cancelled = true; };
    }, []);

    const enabled = isOrg && !!pageId;

    // Crea (o reutilitza) el Y.Doc + provider quan s'activa la col·laboració.
    const collaboration = useMemo(() => {
        // Neteja el provider anterior si canvia la pàgina o es desactiva.
        if (providerRef.current) {
            try { providerRef.current.destroy(); } catch { /* noop */ }
            providerRef.current = null;
            docRef.current = null;
        }
        if (!enabled) return undefined;

        const doc = new Y.Doc();
        const userId = localStorage.getItem('gnosi_user_id') || 'anon';
        const userName = (localStorage.getItem('gnosi_user_email') || 'Anònim').split('@')[0];
        const provider = new GnosiCollabProvider(pageId, doc, { name: userName, color: colorFor(userId) });
        providerRef.current = provider;
        docRef.current = doc;

        return {
            provider,
            fragment: doc.getXmlFragment('document-store'),
            user: { name: userName, color: colorFor(userId) },
        };
    }, [enabled, pageId]);

    useEffect(() => () => {
        if (providerRef.current) {
            try { providerRef.current.destroy(); } catch { /* noop */ }
            providerRef.current = null;
            docRef.current = null;
        }
    }, []);

    return { collaboration, ready: enabled };
}

export default useYjsCollaboration;

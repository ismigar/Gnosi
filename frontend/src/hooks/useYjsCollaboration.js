/**
 * useYjsCollaboration — returns the `collaboration` option for BlockNote when
 * we're in org mode (multi-user). In personal mode it returns `{collaboration:
 * undefined, ready:false}` and does NOT create any Y.Doc or connection → behavior
 * identical to the single-user editor (zero regression).
 *
 * The mode is resolved via `/api/health` (same pattern as useCollaboration) and is
 * memoized at the module level so it isn't repeated on every page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { GnosiCollabProvider } from '../lib/collabProvider';
import { transportFetch } from '../shared/api/transports';

let _modePromise = null;
function resolveMode() {
    if (!_modePromise) {
        _modePromise = transportFetch('/api/health', { credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => d?.gnosi_mode || 'personal')
            .catch(() => 'personal');
    }
    return _modePromise;
}

// Stable per-user colors (cursors), aligned with CollaborationPresence.
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

    // Creates (or reuses) the Y.Doc + provider when collaboration is activated.
    const collaboration = useMemo(() => {
        // Cleans up the previous provider if the page changes or it's deactivated.
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
